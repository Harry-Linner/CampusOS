/*
 * HTTP transports of the ZJU unified-auth client.
 *
 * Moved verbatim out of zjuUnifiedAuth.ts in batch 43 of the ADR-0006 program. Three
 * transports exist because Celechron changes the TLS fingerprint and header shape per
 * service: fetch for the CAS flow, fetch for learning-platform downloads, and node:https
 * for the undergraduate endpoints.
 */
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { MAX_RESPONSE_LENGTH } from "./zjuAuthConfig";
import { ZjuUnifiedAuthError } from "./zjuAuthContracts";
import type { ZjuAuthHttpResponse, ZjuAuthTransport, ZjuLearningDownloadTransport } from "./zjuAuthContracts";
import { splitCombinedSetCookieHeader } from "./zjuAuthCookies";

export const createFetchZjuAuthTransport = (
  fetchImplementation: typeof fetch = globalThis.fetch
): ZjuAuthTransport => {
  if (typeof fetchImplementation !== "function") {
    throw new ZjuUnifiedAuthError(
      "network-error",
      "当前运行环境不支持安全网络请求。"
    );
  }

  return async (request) => {
    const response = await fetchImplementation(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: request.signal
    });
    const contentLength = Number.parseInt(
      response.headers.get("content-length") ?? "0",
      10
    );

    if (contentLength > MAX_RESPONSE_LENGTH) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证服务返回了超出限制的响应。",
        { statusCode: response.status }
      );
    }

    const body = await response.text();
    if (body.length > MAX_RESPONSE_LENGTH) {
      throw new ZjuUnifiedAuthError(
        "protocol-error",
        "统一认证服务返回了超出限制的响应。",
        { statusCode: response.status }
      );
    }

    const headers: Record<string, string | readonly string[]> = {};
    const location = response.headers.get("location");
    const contentType = response.headers.get("content-type");
    if (location) headers.location = location;
    if (contentType) headers["content-type"] = contentType;

    const headersWithSetCookie = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookieHeaders = headersWithSetCookie.getSetCookie?.() ?? [];
    const combinedSetCookie = response.headers.get("set-cookie");
    if (setCookieHeaders.length > 0) {
      headers["set-cookie"] = setCookieHeaders;
    } else if (combinedSetCookie) {
      headers["set-cookie"] = splitCombinedSetCookieHeader(combinedSetCookie);
    }

    return {
      status: response.status,
      headers,
      body
    };
  };
};

export const createFetchZjuLearningDownloadTransport = (
  fetchImplementation: typeof fetch = globalThis.fetch
): ZjuLearningDownloadTransport => async (request) =>
  fetchImplementation(request.url, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    // zju-learning-assistant src-tauri/src/zju_assist.rs:430-479 uses
    // reqwest's redirect-following client for the authenticated blob request.
    redirect: "follow"
  });

export const createNodeHttpsZjuAuthTransport = (): ZjuAuthTransport => {
  const agent = new HttpsAgent({ keepAlive: true });
  return async (request) =>
    new Promise<ZjuAuthHttpResponse>((resolve, reject) => {
      const target = new URL(request.url);
      if (target.protocol !== "https:") {
        reject(
          new ZjuUnifiedAuthError(
            "protocol-error",
            "统一认证请求必须使用 HTTPS。"
          )
        );
        return;
      }

      const nativeRequest = httpsRequest(
        target,
        {
          method: request.method,
          headers: request.headers,
          agent,
          signal: request.signal
        },
        (response) => {
          const contentLength = Number.parseInt(
            String(response.headers["content-length"] ?? "0"),
            10
          );
          if (contentLength > MAX_RESPONSE_LENGTH) {
            response.resume();
            reject(
              new ZjuUnifiedAuthError(
                "protocol-error",
                "统一认证服务返回了超出限制的响应。",
                { statusCode: response.statusCode }
              )
            );
            return;
          }

          const chunks: Buffer[] = [];
          let receivedLength = 0;
          response.on("data", (chunk: Buffer) => {
            receivedLength += chunk.length;
            if (receivedLength > MAX_RESPONSE_LENGTH) {
              nativeRequest.destroy(
                new ZjuUnifiedAuthError(
                  "protocol-error",
                  "统一认证服务返回了超出限制的响应。",
                  { statusCode: response.statusCode }
                )
              );
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("end", () => {
            const headers: Record<string, string | readonly string[]> = {};
            const location = response.headers.location;
            const contentType = response.headers["content-type"];
            const setCookie = response.headers["set-cookie"];
            if (location) headers.location = location;
            if (contentType) headers["content-type"] = contentType;
            if (setCookie) headers["set-cookie"] = setCookie;
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
        }
      );
      nativeRequest.once("error", reject);
      if (request.body) nativeRequest.write(request.body, "utf8");
      nativeRequest.end();
    });
};
