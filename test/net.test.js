import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdvice,
  buildFix,
  childProxyEnv,
  findDshWebPid,
  formatReport,
  parseProcEnviron,
  parseProxyEndpoint,
  probeProxyListen,
  readEnv,
  readProcEnv,
  registryProbeList,
  redactEnv,
  redactSecretUrl,
  withChildProxyEnv,
} from "../lib/net.js";

describe("readEnv", () => {
  it("prefers uppercase proxy keys and fills empty strings", () => {
    const env = readEnv({
      HTTP_PROXY: "http://127.0.0.1:7890",
      https_proxy: "http://127.0.0.1:7890",
      NODE_USE_ENV_PROXY: "1",
    });
    assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7890");
    assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7890");
    assert.equal(env.NO_PROXY, "");
    assert.equal(env.ALL_PROXY, "");
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
  });

  it("reads ALL_PROXY from the lowercase alias", () => {
    const env = readEnv({ all_proxy: "socks5://127.0.0.1:7891" });
    assert.equal(env.ALL_PROXY, "socks5://127.0.0.1:7891");
  });
});

describe("childProxyEnv", () => {
  it("mirrors lowercase aliases and sets NODE_USE_ENV_PROXY=1", () => {
    const extra = childProxyEnv({ HTTP_PROXY: "http://127.0.0.1:7890", ALL_PROXY: "socks5://127.0.0.1:7891" });
    assert.equal(extra.HTTP_PROXY, "http://127.0.0.1:7890");
    assert.equal(extra.http_proxy, "http://127.0.0.1:7890");
    assert.equal(extra.ALL_PROXY, "socks5://127.0.0.1:7891");
    assert.equal(extra.all_proxy, "socks5://127.0.0.1:7891");
    assert.equal(extra.NODE_USE_ENV_PROXY, "1");
  });

  it("keeps NODE_USE_ENV_PROXY=0 when the parent opted out", () => {
    const extra = childProxyEnv({ NODE_USE_ENV_PROXY: "0" });
    assert.equal(extra.NODE_USE_ENV_PROXY, "0");
  });
});

describe("withChildProxyEnv", () => {
  it("lets the spawn spec override inherited proxy env", () => {
    const spec = withChildProxyEnv(
      { command: "node", env: { NODE_USE_ENV_PROXY: "0" } },
      { HTTP_PROXY: "http://127.0.0.1:7890" },
    );
    assert.equal(spec.env.NODE_USE_ENV_PROXY, "0");
    assert.equal(spec.env.HTTP_PROXY, "http://127.0.0.1:7890");
  });

  it("returns non-objects unchanged", () => {
    assert.equal(withChildProxyEnv(null), null);
    assert.equal(withChildProxyEnv("bash"), "bash");
  });
});

describe("registryProbeList", () => {
  it("includes npm and modelscope for registry target", () => {
    const list = registryProbeList({ npm_config_registry: "https://registry.npmmirror.com/" }, "registry");
    assert.ok(list.some((p) => p.name === "npm"));
    assert.ok(list.some((p) => p.name === "modelscope"));
  });
});

describe("buildAdvice", () => {
  it("warns when a proxy is set but Node 24 will ignore it", () => {
    const advice = buildAdvice(
      { HTTP_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "", WSL_DISTRO_NAME: "" },
      [],
      "env",
      true,
    );
    assert.match(advice, /NODE_USE_ENV_PROXY is not 1/);
    assert.match(advice, /fetch failed|Search|restart-dsh-web/i);
    assert.match(advice, /Env only/);
  });

  it("reports probe success and WSL localhost forwarding", () => {
    const advice = buildAdvice(
      { HTTP_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "1", WSL_DISTRO_NAME: "Ubuntu-24.04" },
      [{ ok: true }],
      "all",
      true,
    );
    assert.match(advice, /succeeded/);
    assert.match(advice, /Ubuntu-24.04/);
  });
});

describe("formatReport", () => {
  it("prints env and probes", () => {
    const text = formatReport({
      advice: "ok",
      env: { HTTP_PROXY: "http://127.0.0.1:7890", NO_PROXY: "" },
      probes: [{ ok: true, name: "deepseek", url: "https://api.deepseek.com/", status: 401, ms: 12 }],
    });
    assert.match(text, /HTTP_PROXY=http:\/\/127.0.0.1:7890/);
    assert.match(text, /NO_PROXY=\(empty\)/);
    assert.match(text, /ok deepseek/);
  });

  it("prints fix scripts when present", () => {
    const text = formatReport({
      advice: "need proxy",
      fix: {
        steps: ["Restart with NODE_USE_ENV_PROXY=1"],
        scripts: [{ title: "restart-dsh-with-node-proxy", shell: "bash", code: "export NODE_USE_ENV_PROXY=1\ndsh web" }],
      },
      env: { HTTP_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "" },
      probes: [],
    });
    assert.match(text, /fix:/);
    assert.match(text, /restart-dsh-with-node-proxy/);
    assert.match(text, /NODE_USE_ENV_PROXY=1/);
  });
});

describe("buildFix", () => {
  it("emits restart script when proxy is set but Node ignores it", () => {
    const fix = buildFix(
      { HTTP_PROXY: "http://127.0.0.1:7890", HTTPS_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "" },
      [],
      true,
    );
    assert.ok(fix.scripts.some((s) => s.title === "restart-dsh-with-node-proxy"));
    assert.match(fix.scripts[0].code, /NODE_USE_ENV_PROXY=1/);
    assert.match(fix.scripts[0].code, /restart-dsh-web\.sh|dsh web/);
  });

  it("emits proxy template when probes fail and no proxy is set", () => {
    const fix = buildFix(
      { HTTP_PROXY: "", HTTPS_PROXY: "", NODE_USE_ENV_PROXY: "" },
      [{ ok: false, name: "deepseek" }],
      true,
    );
    assert.ok(fix.scripts.some((s) => s.title === "template-set-proxy-then-start-dsh"));
  });
});

describe("redactSecretUrl", () => {
  it("strips userinfo from proxy URLs", () => {
    assert.equal(redactSecretUrl("http://user:pass@127.0.0.1:7890"), "http://***@127.0.0.1:7890/");
    assert.equal(redactSecretUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
  });
});

describe("redactEnv", () => {
  it("redacts proxy fields and leaves other keys", () => {
    const env = redactEnv({
      HTTP_PROXY: "http://user:secret@127.0.0.1:7890",
      NODE_USE_ENV_PROXY: "1",
    });
    assert.equal(env.HTTP_PROXY, "http://***@127.0.0.1:7890/");
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
  });
});

describe("parseProxyEndpoint / probeProxyListen", () => {
  it("parses host and port", () => {
    assert.deepEqual(parseProxyEndpoint("http://127.0.0.1:16006"), {
      host: "127.0.0.1",
      port: 16006,
      protocol: "http",
    });
  });

  it("reports closed proxy port via injectable probe", async () => {
    const listen = await probeProxyListen(
      { HTTP_PROXY: "http://127.0.0.1:16006" },
      { probeFn: async () => ({ open: false, error: "timeout" }) },
    );
    assert.equal(listen.configured, true);
    assert.equal(listen.open, false);
    assert.equal(listen.port, 16006);
  });

  it("mentions closed proxy in advice", () => {
    const advice = buildAdvice(
      { HTTP_PROXY: "http://127.0.0.1:16006", NODE_USE_ENV_PROXY: "1", WSL_DISTRO_NAME: "" },
      [{ ok: false, name: "deepseek", error: "TypeError: fetch failed" }],
      "all",
      true,
      { configured: true, open: false, host: "127.0.0.1", port: 16006, error: "timeout" },
    );
    assert.match(advice, /not accepting TCP/);
    assert.match(advice, /fetch failed/);
  });
});

describe("dsh web process env", () => {
  it("parses /proc environ and finds pid via injection", () => {
    const raw = Buffer.from("NODE_USE_ENV_PROXY=1\0HTTP_PROXY=http://127.0.0.1:9\0OTHER=x\0");
    const parsed = parseProcEnviron(raw);
    assert.equal(parsed.NODE_USE_ENV_PROXY, "1");
    assert.equal(parsed.HTTP_PROXY, "http://127.0.0.1:9");
    assert.equal(findDshWebPid({ pgrepFn: () => "4242\n" }), 4242);
    const got = readProcEnv(4242, {
      readFileSyncFn: () => raw,
    });
    assert.equal(got.ok, true);
    assert.equal(got.env.NODE_USE_ENV_PROXY, "1");
  });

  it("advises when dsh web host lacks NODE_USE_ENV_PROXY", () => {
    const advice = buildAdvice(
      { HTTP_PROXY: "", NODE_USE_ENV_PROXY: "1", WSL_DISTRO_NAME: "Ubuntu" },
      [],
      "env",
      true,
      { configured: true, open: true, host: "127.0.0.1", port: 7890, error: "" },
      {
        ok: true,
        pid: 99,
        env: { HTTP_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", ALL_PROXY: "", npm_config_registry: "", WSL_DISTRO_NAME: "" },
      },
    );
    assert.match(advice, /pid 99/);
    assert.match(advice, /restart-dsh-web/);
  });
});
