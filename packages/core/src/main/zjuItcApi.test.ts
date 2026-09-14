import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "./zjuAuthCookies";
import type { ZjuAuthHttpResponse } from "./zjuAuthContracts";
import type { ZjuAuthRequestHost, ZjuAuthRequestOptions } from "./zjuAuthHost";
import { ITC_LIST_URL, ZjuItcApi, isItcArticleRequest } from "./zjuItcApi";

const credentials = { username: "student-fixture", password: "password-fixture" };
const articleUrl = "https://itc.zju.edu.cn/2026/2026/c90618a12/page.htm";
const callbackUrl = "http://itc.zju.edu.cn/90618/list.psp?ticket=ST-fixture";
const listBody = '<html><title>资讯中心</title><div class="col_news_list"><ul class="news_list"><li><span class="news_meta">fixture</span><span class="news_title"><a href="/2026/2026/c90618a12/page.htm">fixture article</a></span></li></ul></div></html>';

const response = (
  status: number,
  body: string,
  headers: ZjuAuthHttpResponse["headers"] = {}
): ZjuAuthHttpResponse => ({ status, body, headers });

const httpResponse = (
  status: number,
  body: string,
  headers: { location?: string; "set-cookie"?: string } = {}
): Response => {
  const responseHeaders = new Headers();
  if (headers.location) responseHeaders.set("location", headers.location);
  if (headers["set-cookie"]) responseHeaders.set("set-cookie", headers["set-cookie"]);
  return new Response(body, { status, headers: responseHeaders });
};

type DeferredResponse = () => Promise<Response | ZjuAuthHttpResponse>;
type PlannedResponse = Response | ZjuAuthHttpResponse | DeferredResponse;

const createHarness = (options: {
  httpResponses?: PlannedResponse[];
  httpsResponses?: PlannedResponse[];
  serviceResponse?: ZjuAuthHttpResponse;
} = {}) => {
  const hostRequests: Array<{
    method: "GET" | "POST";
    url: string;
    options?: ZjuAuthRequestOptions;
  }> = [];
  const httpRequests: Array<{ url: string; init?: RequestInit }> = [];
  const httpResponses = [...(options.httpResponses ?? [])];
  const httpsResponses = [...(options.httpsResponses ?? [])];
  const seedCookies = new CookieJar();
  seedCookies.store(
    "https://zjuam.zju.edu.cn/cas/login",
    [
      "iPlanetDirectoryPro=sso-fixture; Domain=.zju.edu.cn; Path=/",
      "cas-only=must-not-cross-service; Path=/cas"
    ]
  );

  const next = async (planned: PlannedResponse): Promise<Response | ZjuAuthHttpResponse> =>
    typeof planned === "function" ? planned() : planned;

  const host: ZjuAuthRequestHost = {
    timeoutMs: 1_000,
    now: () => new Date("2026-09-13T00:00:00.000Z"),
    authenticateCas: vi.fn(async () => ({ username: credentials.username, cookies: seedCookies })),
    request: vi.fn(async (method, url, requestOptions) => {
      hostRequests.push({ method, url, options: requestOptions });
      if (new URL(url).hostname === "zjuam.zju.edu.cn") {
        return options.serviceResponse ?? response(302, "", { location: callbackUrl });
      }
      const planned = httpsResponses.shift();
      if (!planned) throw new Error(`Unexpected HTTPS request: ${method} ${url}`);
      return (await next(planned)) as ZjuAuthHttpResponse;
    })
  };

  const httpFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    httpRequests.push({ url, init });
    const planned = httpResponses.shift();
    if (!planned) throw new Error(`Unexpected HTTP request: ${url}`);
    return (await next(planned)) as Response;
  });

  return {
    host,
    httpFetch,
    hostRequests,
    httpRequests,
    authenticateCas: host.authenticateCas as ReturnType<typeof vi.fn>
  };
};

const cookieFromInit = (init: RequestInit | undefined): string =>
  String((init?.headers as Record<string, string> | undefined)?.cookie ?? "");

describe("ZjuItcApi", () => {
  it("follows the verified HTTP/HTTPS callback chain and carries each hop's cookies", async () => {
    const harness = createHarness({
      httpResponses: [
        httpResponse(301, "", {
          location: "https://itc.zju.edu.cn/90618/list.psp",
          "set-cookie": "itc-http-1=one; Path=/90618"
        }),
        httpResponse(301, "", {
          location: "https://itc.zju.edu.cn/90618/list.psp",
          "set-cookie": "itc-http-2=two; Path=/90618"
        })
      ],
      httpsResponses: [
        response(302, "", {
          location: "http://itc.zju.edu.cn/90618/list.psp",
          "set-cookie": ["itc-https-1=one; Path=/90618"]
        }),
        response(200, listBody, {
          "set-cookie": ["itc-https-2=two; Path=/90618"]
        })
      ]
    });

    const result = await new ZjuItcApi(
      harness.host,
      harness.httpFetch as unknown as typeof fetch
    ).request(credentials, ITC_LIST_URL);

    expect(result).toEqual({ status: 200, body: listBody });
    expect(harness.authenticateCas).toHaveBeenCalledTimes(1);
    expect(harness.httpRequests).toHaveLength(2);
    expect(harness.hostRequests).toHaveLength(3);

    expect(harness.hostRequests[0]?.url).toContain("service=http%3A%2F%2Fitc.zju.edu.cn");
    expect(harness.hostRequests[0]?.options?.cookie).toContain("iPlanetDirectoryPro=sso-fixture");
    expect(cookieFromInit(harness.httpRequests[0]?.init)).toContain("iPlanetDirectoryPro=sso-fixture");
    expect(cookieFromInit(harness.httpRequests[0]?.init)).not.toContain("cas-only");
    expect(cookieFromInit(harness.httpRequests[0]?.init)).not.toContain("itc-http-1");
    expect(harness.hostRequests[1]?.options?.cookie).toContain("itc-http-1=one");
    expect(harness.hostRequests[1]?.options?.cookie).toContain("iPlanetDirectoryPro=sso-fixture");
    expect(cookieFromInit(harness.httpRequests[1]?.init)).toContain("itc-https-1=one");
    expect(cookieFromInit(harness.httpRequests[1]?.init)).toContain("itc-http-1=one");
    expect(harness.hostRequests[2]?.options?.cookie).toContain("itc-http-2=two");
    expect(harness.hostRequests[2]?.options?.cookie).toContain("itc-https-1=one");
  });

  it("keeps an ITC Domain cookie inside the isolated service jar", async () => {
    const harness = createHarness({
      httpResponses: [
        httpResponse(301, "", {
          location: "https://itc.zju.edu.cn/90618/list.psp",
          "set-cookie": "itc-domain=service-only; Domain=.zju.edu.cn; Path=/"
        }),
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" }),
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" }),
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" })
      ],
      httpsResponses: [
        response(302, "", { location: "http://itc.zju.edu.cn/90618/list.psp" }),
        response(200, listBody),
        response(302, "", { location: "http://itc.zju.edu.cn/90618/list.psp" }),
        response(200, listBody)
      ]
    });
    const client = new ZjuItcApi(harness.host, harness.httpFetch as unknown as typeof fetch);

    await expect(client.request(credentials, ITC_LIST_URL)).resolves.toEqual({
      status: 200,
      body: listBody
    });
    expect(cookieFromInit(harness.httpRequests[1]?.init)).toContain("itc-domain=service-only");

    client.clear();
    await expect(client.request(credentials, ITC_LIST_URL)).resolves.toEqual({
      status: 200,
      body: listBody
    });
    const serviceRequests = harness.hostRequests.filter(
      ({ url }) => new URL(url).hostname === "zjuam.zju.edu.cn"
    );
    expect(serviceRequests).toHaveLength(2);
    expect(serviceRequests[1]?.options?.cookie).not.toContain("itc-domain=service-only");
    expect(cookieFromInit(harness.httpRequests[2]?.init)).not.toContain("itc-domain=service-only");
  });

  it("single-flights and caches a session for the same account", async () => {
    let releaseFinal!: () => void;
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
    const harness = createHarness({
      httpResponses: [
        httpResponse(301, "", {
          location: "https://itc.zju.edu.cn/90618/list.psp",
          "set-cookie": "itc-http=one; Path=/90618"
        }),
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" })
      ],
      httpsResponses: [
        response(302, "", { location: "http://itc.zju.edu.cn/90618/list.psp" }),
        async () => {
          await finalGate;
          return response(200, listBody);
        },
        response(200, '<title>资讯</title>article fixture')
      ]
    });
    const client = new ZjuItcApi(harness.host, harness.httpFetch as unknown as typeof fetch);

    const first = client.request(credentials, ITC_LIST_URL);
    const second = client.request(credentials, ITC_LIST_URL);
    expect(harness.authenticateCas).toHaveBeenCalledTimes(1);
    releaseFinal();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 200, body: listBody },
      { status: 200, body: listBody }
    ]);
    await expect(client.request(credentials, articleUrl)).resolves.toEqual({
      status: 200,
      body: '<title>资讯</title>article fixture'
    });
    expect(harness.authenticateCas).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect an in-flight session after clear", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const harness = createHarness({
      httpResponses: [
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" }),
        httpResponse(301, "", { location: "https://itc.zju.edu.cn/90618/list.psp" })
      ],
      httpsResponses: [
        async () => {
          await firstGate;
          return response(200, listBody);
        },
        response(200, listBody)
      ]
    });
    const client = new ZjuItcApi(harness.host, harness.httpFetch as unknown as typeof fetch);
    const first = client.request(credentials, ITC_LIST_URL);
    client.clear();
    releaseFirst();

    await expect(first).rejects.toMatchObject({ code: "service-verification-failed" });
    await expect(client.request(credentials, ITC_LIST_URL)).resolves.toEqual({
      status: 200,
      body: listBody
    });
    expect(harness.authenticateCas).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin, malformed, and ticketless authentication inputs", async () => {
    expect(isItcArticleRequest("https://example.com/2026/2026/c12a34/page.htm")).toBe(false);
    expect(isItcArticleRequest("http://itc.zju.edu.cn/90618/list.psp")).toBe(false);
    expect(isItcArticleRequest(`${articleUrl}?ticket=leak`)).toBe(false);
    expect(isItcArticleRequest("https://itc.zju.edu.cn/2026/2026/c12a34/page.txt")).toBe(false);

    const invalidHarness = createHarness();
    const invalidClient = new ZjuItcApi(invalidHarness.host);
    await expect(invalidClient.request(credentials, "https://example.com/private")).rejects.toMatchObject({
      code: "invalid-input"
    });
    expect(invalidHarness.authenticateCas).not.toHaveBeenCalled();

    const ticketlessHarness = createHarness({
      serviceResponse: response(302, "", { location: "http://itc.zju.edu.cn/90618/list.psp" })
    });
    await expect(new ZjuItcApi(ticketlessHarness.host).request(credentials, ITC_LIST_URL))
      .rejects.toMatchObject({ code: "service-verification-failed" });
  });

  it("enforces the HTTP response size limit before parsing the body", async () => {
    const harness = createHarness({
      httpResponses: [httpResponse(200, "x".repeat(4_000_001))]
    });

    await expect(new ZjuItcApi(
      harness.host,
      harness.httpFetch as unknown as typeof fetch
    ).request(credentials, ITC_LIST_URL)).rejects.toMatchObject({ code: "protocol-error" });
  });

  it("preserves a failed session as an error and retries instead of inventing business data", async () => {
    const harness = createHarness({
      httpResponses: [
        httpResponse(200, "<html><title>统一身份认证</title>login fixture</html>"),
        httpResponse(200, listBody)
      ]
    });
    const client = new ZjuItcApi(harness.host, harness.httpFetch as unknown as typeof fetch);

    await expect(client.request(credentials, ITC_LIST_URL)).rejects.toMatchObject({
      code: "service-verification-failed"
    });
    await expect(client.request(credentials, ITC_LIST_URL)).resolves.toEqual({
      status: 200,
      body: listBody
    });
    expect(harness.authenticateCas).toHaveBeenCalledTimes(2);
  });
});
