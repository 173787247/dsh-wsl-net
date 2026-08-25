import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdvice,
  childProxyEnv,
  formatReport,
  readEnv,
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

describe("buildAdvice", () => {
  it("warns when a proxy is set but Node 24 will ignore it", () => {
    const advice = buildAdvice(
      { HTTP_PROXY: "http://127.0.0.1:7890", NODE_USE_ENV_PROXY: "", WSL_DISTRO_NAME: "" },
      [],
      "env",
      true,
    );
    assert.match(advice, /NODE_USE_ENV_PROXY is not 1/);
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
