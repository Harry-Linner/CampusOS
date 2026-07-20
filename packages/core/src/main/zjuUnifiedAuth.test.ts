import { describe, expect, it, vi } from "vitest";
import {
  ZjuUnifiedAuthError,
  createZjuUnifiedAuthClient,
  type ZjuAuthHttpRequest,
  type ZjuAuthHttpResponse,
  type ZjuAuthTransport
} from "./zjuUnifiedAuth";

const modulus = `c7${"f".repeat(126)}`;

const authenticatedContext = Buffer.from(
  JSON.stringify({
    anonymous: false,
    userId: "authenticated-user-id",
    roles: ["STUDENT"]
  }),
  "utf8"
).toString("base64");

const response = (
  status: number,
  body: string,
  headers: ZjuAuthHttpResponse["headers"] = {}
): ZjuAuthHttpResponse => ({ status, body, headers });

const createSequenceTransport = (
  responses: ZjuAuthHttpResponse[]
): {
  requests: ZjuAuthHttpRequest[];
  transport: ZjuAuthTransport;
} => {
  const requests: ZjuAuthHttpRequest[] = [];
  const transport = vi.fn(async (request: ZjuAuthHttpRequest) => {
    requests.push(request);
    const nextResponse = responses.shift();

    if (!nextResponse) {
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    }

    return nextResponse;
  });

  return { requests, transport };
};

const authenticatedServicePrelude = (): ZjuAuthHttpResponse[] => [
  response(200, '<input name="execution" value="e1s1">'),
  response(200, JSON.stringify({ modulus, exponent: "10001" })),
  response(302, "", {
    "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
  }),
  response(302, "", {
    location:
      "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html?ticket=ST-academic"
  }),
  response(302, "", {
    "set-cookie": [
      "JSESSIONID=academic-session; Path=/jwglxt; HttpOnly",
      "route=route-value; Path=/jwglxt; HttpOnly"
    ]
  }),
  response(302, "", {
    location: "https://sztz.zju.edu.cn/dekt/?ticket=ST-quality"
  }),
  response(200, "quality development home", {
    "set-cookie": ["SESSION=quality-session; Path=/dekt; Secure; HttpOnly"]
  })
];

describe("ZjuUnifiedAuthClient", () => {
  it("reuses an opaque undergraduate session without exposing service cookies", async () => {
    const { requests, transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
      }),
      response(302, "", {
        location:
          "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html?ticket=ST-academic"
      }),
      response(302, "", {
        "set-cookie": [
          "JSESSIONID=academic-session; Path=/jwglxt; HttpOnly",
          "route=route-value; Path=/jwglxt; HttpOnly"
        ]
      }),
      response(200, JSON.stringify({ kbList: [] })),
      response(200, "null"),
      response(200, JSON.stringify({ items: [] })),
      response(200, JSON.stringify({ items: [] }))
    ]);
    const client = createZjuUnifiedAuthClient({ transport });
    const credentials = {
      username: "3240100001",
      password: "real password"
    };

    const first = await client.requestUndergraduateService(credentials, {
      operation: "timetable",
      academicYearStart: 2025,
      season: "2|夏"
    });
    const second = await client.requestUndergraduateService(credentials, {
      operation: "timetable",
      academicYearStart: 2026,
      season: "1|秋"
    });
    const exams = await client.requestUndergraduateService(credentials, {
      operation: "exams"
    });
    const grades = await client.requestUndergraduateService(credentials, {
      operation: "grades"
    });

    expect(first).toEqual({ status: 200, body: JSON.stringify({ kbList: [] }) });
    expect(second).toEqual({ status: 200, body: "null" });
    expect(exams).toEqual({
      status: 200,
      body: JSON.stringify({ items: [] })
    });
    expect(grades).toEqual({
      status: 200,
      body: JSON.stringify({ items: [] })
    });
    expect(JSON.stringify([first, second, exams, grades])).not.toContain(
      "academic-session"
    );
    expect(requests).toHaveLength(9);
    expect(requests[5].headers.Cookie).toContain("JSESSIONID=academic-session");
    expect(requests[5].headers.Cookie).toContain("route=route-value");
    expect(new URLSearchParams(requests[5].body)).toEqual(
      new URLSearchParams({ xnm: "2025", xqm: "2|夏", captcha_value: "" })
    );
    expect(requests[6].headers.Cookie).toContain("JSESSIONID=academic-session");
    expect(requests[7].url).toContain("/xskscx/kscx_cxXsgrksIndex.html");
    expect(requests[7].headers.Cookie).toContain("JSESSIONID=academic-session");
    expect(requests[8].url).toContain("/cxdy/xscjcx_cxXscjIndex.html");
    expect(requests[8].headers.Cookie).toContain("JSESSIONID=academic-session");
  });

  it("exchanges a graduate CAS ticket for an opaque reusable access token", async () => {
    const timetableBody = JSON.stringify({
      success: true,
      result: { kcbMap: {} }
    });
    const gradesBody = JSON.stringify({
      success: true,
      result: { xxjhnList: [] }
    });
    const { requests, transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
      }),
      response(302, "", {
        location: "https://yjsy.zju.edu.cn/?ticket=ST-graduate"
      }),
      response(200, JSON.stringify({
        success: true,
        result: { token: "graduate-token" }
      })),
      response(200, timetableBody),
      response(200, gradesBody)
    ]);
    const client = createZjuUnifiedAuthClient({ transport });
    const credentials = {
      username: "2240100001",
      password: "real password"
    };

    const timetable = await client.requestGraduateService(credentials, {
      operation: "timetable",
      academicYearStart: 2025,
      term: 14
    });
    const grades = await client.requestGraduateService(credentials, {
      operation: "grades"
    });

    expect(timetable).toEqual({ status: 200, body: timetableBody });
    expect(grades).toEqual({ status: 200, body: gradesBody });
    expect(JSON.stringify([timetable, grades])).not.toContain("graduate-token");
    expect(requests).toHaveLength(7);
    expect(requests[3].url).toContain(
      "service=https%3A%2F%2Fyjsy.zju.edu.cn%2F"
    );
    expect(requests[4].url).toContain("/dataapi/sys/cas/client/validateLogin");
    expect(requests[4].url).toContain("ticket=ST-graduate");
    expect(requests[5].headers["X-Access-Token"]).toBe("graduate-token");
    expect(requests[5].url).toContain("xn=2025");
    expect(requests[5].url).toContain("pkxq=14");
    expect(requests[6].headers["X-Access-Token"]).toBe("graduate-token");
    expect(requests[6].method).toBe("POST");
  });

  it("verifies a graduate account with authenticated business data before reporting success", async () => {
    const { requests, transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
      }),
      response(302, "", {
        location: "https://yjsy.zju.edu.cn/?ticket=ST-graduate-proof"
      }),
      response(200, JSON.stringify({
        success: true,
        result: { token: "graduate-proof-token" }
      })),
      response(200, JSON.stringify({
        success: true,
        result: {
          xxjhnList: [
            { kcmc: "private-course-name" },
            { kcmc: "another-private-course" }
          ]
        }
      }))
    ]);
    const client = createZjuUnifiedAuthClient({
      transport,
      now: () => new Date("2026-07-19T08:00:00.000Z")
    });

    const result = await client.authenticate({
      username: "2240100001",
      password: "real password",
      program: "graduate"
    });

    expect(result).toEqual({
      provider: "zju-unified-auth",
      username: "2240100001",
      authenticatedAt: "2026-07-19T08:00:00.000Z",
      program: "graduate",
      verifiedService: "graduate-academic-affairs",
      authenticatedProfile: {
        source: "zju-graduate-academic-affairs",
        studentId: "2240100001",
        verifiedDataset: "graduate-grades",
        recordCount: 2,
        fetchedAt: "2026-07-19T08:00:00.000Z"
      }
    });
    expect(JSON.stringify(result)).not.toContain("graduate-proof-token");
    expect(JSON.stringify(result)).not.toContain("private-course-name");
    expect(requests[5].url).toContain("queryXsxkByXnxqXs");
    expect(requests[5].headers["X-Access-Token"]).toBe(
      "graduate-proof-token"
    );
  });

  it("rejects a graduate ticket callback outside the fixed service origin", async () => {
    const { transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
      }),
      response(302, "", {
        location: "https://example.com/?ticket=ST-stolen"
      })
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(client.requestGraduateService(
      { username: "2240100001", password: "real password" },
      { operation: "grades" }
    )).rejects.toMatchObject({
      code: "service-verification-failed"
    });
  });

  it("follows the complete learning-service login chain before returning todos", async () => {
    const todosBody = JSON.stringify({
      todo_list: [
        { id: "1", title: "统一身份认证课程作业", is_student: true }
      ]
    });
    const { requests, transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": [
          "iPlanetDirectoryPro=sso-value; Domain=.zju.edu.cn; Path=/; Secure"
        ]
      }),
      response(302, "", {
        location: "https://identity.zju.edu.cn/auth/continue"
      }),
      response(
        200,
        '<meta http-equiv="refresh" content="0;url=https://courses.zju.edu.cn/user/index?authenticated=1">'
      ),
      response(200, "learning home", {
        "set-cookie": ["session=learning-session; Path=/; Secure; HttpOnly"]
      }),
      response(200, todosBody)
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    const result = await client.requestLearningService(
      { username: "3240100001", password: "real password" },
      { operation: "todos" }
    );

    expect(result).toEqual({ status: 200, body: todosBody });
    expect(JSON.stringify(result)).not.toContain("learning-session");
    expect(requests).toHaveLength(7);
    expect(requests[3].url).toBe("https://courses.zju.edu.cn/user/index");
    expect(requests[4].url).toBe("https://identity.zju.edu.cn/auth/continue");
    expect(requests[5].url).toContain("authenticated=1");
    expect(requests[6].url).toBe("https://courses.zju.edu.cn/api/todos");
    expect(requests[6].headers.Cookie).toContain("session=learning-session");
  });

  it("rejects learning-service redirects outside the explicit ZJU host set", async () => {
    const { transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": [
          "iPlanetDirectoryPro=sso-value; Domain=.zju.edu.cn; Path=/; Secure"
        ]
      }),
      response(302, "", { location: "https://example.com/steal-session" })
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.requestLearningService(
        { username: "3240100001", password: "real password" },
        { operation: "todos" }
      )
    ).rejects.toMatchObject({
      code: "protocol-error",
      message: "学在浙大登录返回了不受信任的跳转地址。"
    });
  });

  it("returns authenticated practice-point data only after both service sessions are verified", async () => {
    const { requests, transport } = createSequenceTransport([
      response(
        200,
        '<form><input value="e1s1" type="hidden" name="execution"></form>',
        {
          "set-cookie": [
            "_csrf=csrf-value; Path=/cas; Secure; HttpOnly",
            "_pv0=visitor-value; Path=/; Secure"
          ]
        }
      ),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        location: "https://zjuam.zju.edu.cn/cas/login",
        "set-cookie": [
          "iPlanetDirectoryPro=sso-value; Domain=.zju.edu.cn; Path=/; Secure; HttpOnly"
        ]
      }),
      response(302, "", {
        location:
          "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html?ticket=ST-sensitive"
      }),
      response(302, "", {
        location: "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_initMenu.html",
        "set-cookie": [
          "JSESSIONID=academic-session; Path=/jwglxt; HttpOnly",
          "route=route-value; Path=/jwglxt; HttpOnly"
        ]
      }),
      response(302, "", {
        location:
          "https://sztz.zju.edu.cn/dekt/?ticket=ST-quality-sensitive"
      }),
      response(200, "quality development home", {
        "set-cookie": [
          "SESSION=quality-session; Path=/dekt; Secure; HttpOnly; SameSite=Lax"
        ]
      }),
      response(
        200,
        JSON.stringify({ success: true, code: 0, data: authenticatedContext })
      ),
      response(
        200,
        JSON.stringify({
          code: 0,
          extend: {
            myInfo: {
              xh: "3240100001",
              dektJf: "3.45",
              dsktJf: 1,
              dsiktJf: null
            }
          }
        })
      )
    ]);
    const client = createZjuUnifiedAuthClient({
      transport,
      now: () => new Date("2026-07-18T08:00:00.000Z")
    });

    const result = await client.authenticate({
      username: " 3240100001 ",
      password: "real password",
      program: "undergraduate"
    });

    expect(result).toEqual({
      provider: "zju-unified-auth",
      username: "3240100001",
      authenticatedAt: "2026-07-18T08:00:00.000Z",
      program: "undergraduate",
      verifiedService: "undergraduate-academic-affairs",
      authenticatedProfile: {
        source: "zju-quality-development",
        studentId: "3240100001",
        secondClassPoints: 3.45,
        thirdClassPoints: 1,
        fourthClassPoints: 0,
        fetchedAt: "2026-07-18T08:00:00.000Z"
      }
    });
    expect(JSON.stringify(result)).not.toContain("ST-sensitive");
    expect(JSON.stringify(result)).not.toContain("ST-quality-sensitive");
    expect(JSON.stringify(result)).not.toContain("quality-session");
    expect(requests.map(({ method, url }) => [method, url])).toEqual([
      ["GET", "https://zjuam.zju.edu.cn/cas/login"],
      ["GET", "https://zjuam.zju.edu.cn/cas/v2/getPubKey"],
      ["POST", "https://zjuam.zju.edu.cn/cas/login"],
      [
        "GET",
        "https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fzdbk.zju.edu.cn%2Fjwglxt%2Fxtgl%2Flogin_ssologin.html"
      ],
      [
        "GET",
        "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html?ticket=ST-sensitive"
      ],
      [
        "GET",
        "https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fsztz.zju.edu.cn%2Fdekt%2F"
      ],
      [
        "GET",
        "https://sztz.zju.edu.cn/dekt/?ticket=ST-quality-sensitive"
      ],
      ["POST", "https://sztz.zju.edu.cn/dekt/ctx"],
      [
        "GET",
        "https://sztz.zju.edu.cn/dekt/student/home/getMyInfo"
      ]
    ]);

    const loginForm = new URLSearchParams(requests[2].body);
    expect(loginForm.get("username")).toBe("3240100001");
    expect(loginForm.get("password")).toMatch(/^[0-9a-f]{128}$/);
    expect(loginForm.get("password")).not.toContain("real password");
    expect(loginForm.get("execution")).toBe("e1s1");
    expect(loginForm.get("_eventId")).toBe("submit");
    expect(loginForm.get("rememberMe")).toBe("true");
    expect(requests[1].headers.Cookie).toContain("_csrf=csrf-value");
    expect(requests[2].headers.Cookie).toContain("_pv0=visitor-value");
    expect(requests[3].headers.Cookie).toContain(
      "iPlanetDirectoryPro=sso-value"
    );
    expect(requests[5].headers.Cookie).toContain(
      "iPlanetDirectoryPro=sso-value"
    );
    expect(requests[7].headers.Cookie).toContain("SESSION=quality-session");
    expect(requests[8].headers.Cookie).toContain("SESSION=quality-session");
  });

  it("classifies a rejected login without attempting a service callback", async () => {
    const { requests, transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(200, '<div class="errors">用户名或密码错误</div>')
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    const error = await client
      .authenticate({
        username: "3240100001",
        password: "wrong",
        program: "undergraduate"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ZjuUnifiedAuthError);
    expect(error).toMatchObject({ code: "invalid-credentials" });
    expect(requests).toHaveLength(3);
  });

  it("fails closed when the CAS login form no longer contains execution", async () => {
    const { transport } = createSequenceTransport([
      response(200, "<html>changed login page</html>")
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "protocol-error" });
  });

  it("does not mark login successful when the academic service omits its route cookie", async () => {
    const { transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(302, "", {
        "set-cookie": ["iPlanetDirectoryPro=sso-value; Path=/; Secure"]
      }),
      response(302, "", {
        location:
          "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html?ticket=ST-sensitive"
      }),
      response(302, "", {
        "set-cookie": ["JSESSIONID=academic-session; Path=/jwglxt; HttpOnly"]
      })
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "service-verification-failed" });
  });

  it("rejects a formal quality-development session when ctx remains anonymous", async () => {
    const anonymousContext = Buffer.from(
      JSON.stringify({
        anonymous: true,
        userId: "ANONYMOUS",
        roles: ["ANONYMOUS_USER_ROLE"]
      }),
      "utf8"
    ).toString("base64");
    const { requests, transport } = createSequenceTransport([
      ...authenticatedServicePrelude(),
      response(
        200,
        JSON.stringify({ success: true, code: 0, data: anonymousContext })
      )
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "service-verification-failed" });
    expect(requests).toHaveLength(8);
  });

  it("rejects getMyInfo data returned for a different account", async () => {
    const { transport } = createSequenceTransport([
      ...authenticatedServicePrelude(),
      response(
        200,
        JSON.stringify({ success: true, code: 0, data: authenticatedContext })
      ),
      response(
        200,
        JSON.stringify({
          code: 0,
          extend: {
            myInfo: {
              xh: "3240100002",
              dektJf: 3.45,
              dsktJf: 1,
              dsiktJf: 0
            }
          }
        })
      )
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "service-verification-failed" });
  });

  it("classifies an interactive verification challenge separately", async () => {
    const { transport } = createSequenceTransport([
      response(200, '<input name="execution" value="e1s1">'),
      response(200, JSON.stringify({ modulus, exponent: "10001" })),
      response(200, "<p>请输入验证码后继续</p>")
    ]);
    const client = createZjuUnifiedAuthClient({ transport });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "interactive-verification-required" });
  });

  it("aborts a hanging request and returns a timeout classification", async () => {
    let wasAborted = false;
    const transport: ZjuAuthTransport = (request) => {
      request.signal.addEventListener("abort", () => {
        wasAborted = true;
      });
      return new Promise(() => undefined);
    };
    const client = createZjuUnifiedAuthClient({ transport, timeoutMs: 5 });

    await expect(
      client.authenticate({
        username: "3240100001",
        password: "secret",
        program: "undergraduate"
      })
    ).rejects.toMatchObject({ code: "timeout" });
    expect(wasAborted).toBe(true);
  });
});
