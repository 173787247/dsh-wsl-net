export const name = "dsh-wsl-net";
export const inject = ["tools", "systemPrompt", "subprocess"];

export function apply(ctx, config = {}) {
  const timeoutMs = positive(config.timeoutMs, 20_000);
  const probeTimeoutMs = positive(config.probeTimeoutMs, 5_000);
  const injectChildProxy = config.injectChildProxy !== false;

  if (injectChildProxy) {
    installChildProxy(ctx.subprocess);
    console.log("[dsh-wsl-net] injecting NODE_USE_ENV_PROXY into subprocess env");
  }

  ctx.systemPrompt.section({
    name: "tool:net_doctor",
    order: 116,
    text: [
      "Use the net_doctor tool when DeepSeek API, npm, or other HTTPS calls fail from this agent.",
      "The browser on Windows can work while WSL Node fetch does not: Node 24 ignores HTTP_PROXY unless NODE_USE_ENV_PROXY=1.",
      injectChildProxy
        ? "This plugin also sets NODE_USE_ENV_PROXY=1 (and lowercase http_proxy aliases) on bash/npm child processes."
        : "Child bash/npm processes may still need NODE_USE_ENV_PROXY=1 even when this dsh process has it.",
      "Do not guess proxy URLs or restart random services; read the tool's advice field.",
    ].join(" "),
  });

  ctx.tools.register({
    name: "net_doctor",
    description: "Diagnose WSL/Windows proxy and Node 24 fetch: reports HTTP_PROXY, NODE_USE_ENV_PROXY, and probes DeepSeek API and the npm registry. Use when network or API calls fail.",
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        target: {
          type: "string",
          enum: ["all", "env", "deepseek", "npm"],
          description: "What to check. Default all: env plus DeepSeek and npm probes.",
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          advice: { type: "string" },
          env: {
            type: "object",
            additionalProperties: false,
            properties: {
              HTTP_PROXY: { type: "string" },
              HTTPS_PROXY: { type: "string" },
              NO_PROXY: { type: "string" },
              NODE_USE_ENV_PROXY: { type: "string" },
              npm_config_registry: { type: "string" },
              WSL_DISTRO_NAME: { type: "string" },
            },
          },
          probes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                url: { type: "string" },
                ok: { type: "boolean" },
                status: { type: "integer" },
                error: { type: "string" },
                ms: { type: "integer" },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: formatReport(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = typeof args?.target === "string" ? args.target : "all";
      const allowed = new Set(["all", "env", "deepseek", "npm"]);
      const selected = allowed.has(target) ? target : "all";
      const env = readEnv();
      const probes = [];
      if (selected === "all" || selected === "deepseek") {
        probes.push(await probe("deepseek", "https://api.deepseek.com/", exec.signal, probeTimeoutMs));
      }
      if (selected === "all" || selected === "npm") {
        const registry = env.npm_config_registry || "https://registry.npmmirror.com/";
        probes.push(await probe("npm", registry, exec.signal, probeTimeoutMs));
      }
      return {
        advice: buildAdvice(env, probes, selected, injectChildProxy),
        env,
        probes,
      };
    },
    presentCall: () => ({ card: "generic", title: "Network doctor" }),
    presentResult: (_args, result) => (
      result.isError
        ? { card: "generic", title: "Network doctor failed", content: result.content }
        : { card: "generic", title: "Network doctor", content: result.content }
    ),
  });
}

const PATCHED = Symbol.for("dsh-wsl-net.subprocess-patched");

function installChildProxy(subprocess) {
  if (subprocess[PATCHED]) return;
  subprocess[PATCHED] = true;
  wrapSpawn(subprocess, "spawn");
  wrapSpawn(subprocess, "spawnTerminal");
}

function wrapSpawn(subprocess, method) {
  const original = subprocess[method];
  if (typeof original !== "function") return;
  subprocess[method] = function patchedSpawn(spec, ...rest) {
    return original.call(this, withChildProxyEnv(spec), ...rest);
  };
}

function withChildProxyEnv(spec) {
  if (!spec || typeof spec !== "object") return spec;
  return {
    ...spec,
    env: {
      ...childProxyEnv(),
      ...spec.env,
    },
  };
}

function childProxyEnv() {
  const extra = {};
  const http = process.env.HTTP_PROXY || process.env.http_proxy;
  const https = process.env.HTTPS_PROXY || process.env.https_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (http) {
    extra.HTTP_PROXY = http;
    extra.http_proxy = http;
  }
  if (https) {
    extra.HTTPS_PROXY = https;
    extra.https_proxy = https;
  }
  if (noProxy) {
    extra.NO_PROXY = noProxy;
    extra.no_proxy = noProxy;
  }
  extra.NODE_USE_ENV_PROXY = process.env.NODE_USE_ENV_PROXY === "0" ? "0" : "1";
  return extra;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readEnv() {
  return {
    HTTP_PROXY: pickEnv("HTTP_PROXY", "http_proxy"),
    HTTPS_PROXY: pickEnv("HTTPS_PROXY", "https_proxy"),
    NO_PROXY: pickEnv("NO_PROXY", "no_proxy"),
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "",
    npm_config_registry: process.env.npm_config_registry ?? "",
    WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME ?? "",
  };
}

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

function proxyOn(env) {
  return Boolean(env.HTTP_PROXY || env.HTTPS_PROXY);
}

function proxyHonored(env) {
  return env.NODE_USE_ENV_PROXY === "1";
}

async function probe(name, url, callerSignal, probeTimeoutMs) {
  const started = Date.now();
  try {
    const signal = AbortSignal.any([
      callerSignal,
      AbortSignal.timeout(probeTimeoutMs),
    ]);
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal,
    });
    return {
      name,
      url,
      ok: res.status > 0 && res.status < 500,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return {
      name,
      url,
      ok: false,
      error,
      ms: Date.now() - started,
    };
  }
}

function buildAdvice(env, probes, target, injectChildProxy) {
  const lines = [];
  const failed = probes.filter((p) => !p.ok);
  if (target === "env") {
    lines.push("Env only; no HTTPS probe ran.");
  }
  if (proxyOn(env) && !proxyHonored(env)) {
    lines.push("HTTP_PROXY is set but NODE_USE_ENV_PROXY is not 1. Node 24 fetch in this dsh process ignores the proxy. Restart dsh with NODE_USE_ENV_PROXY=1.");
    if (injectChildProxy) {
      lines.push("bash/npm children still receive NODE_USE_ENV_PROXY=1 from this plugin.");
    }
  }
  if (!proxyOn(env) && failed.length > 0) {
    lines.push("No HTTP_PROXY/HTTPS_PROXY in this process. If Clash/V2Ray runs on Windows, WSL often needs http://127.0.0.1:<mixed-port> (localhost forwards to Windows).");
  }
  if (proxyOn(env) && proxyHonored(env) && failed.length > 0) {
    lines.push("Proxy env is set and Node should honor it, but a probe still failed. Check that the proxy port is listening and allows api.deepseek.com / the npm registry.");
  }
  if (failed.length === 0 && (target === "all" || probes.length > 0)) {
    lines.push("HTTPS probes from this dsh process succeeded.");
    lines.push(
      injectChildProxy
        ? "bash/npm children are given NODE_USE_ENV_PROXY=1 and lowercase http_proxy aliases by this plugin."
        : "If a bash/npm child still fails, that child may not inherit NODE_USE_ENV_PROXY.",
    );
  }
  if (env.WSL_DISTRO_NAME) {
    lines.push(`Running in WSL distro ${env.WSL_DISTRO_NAME}; 127.0.0.1 in this process is the WSL side (Windows proxy ports are usually forwarded).`);
  }
  return lines.join(" ");
}

function formatReport(value) {
  const envLines = Object.entries(value.env).map(([k, v]) => `${k}=${v || "(empty)"}`);
  const probeLines = value.probes.length === 0
    ? ["(no probes)"]
    : value.probes.map((p) => {
      const extra = p.ok ? `status ${p.status}` : (p.error || `status ${p.status ?? "?"}`);
      return `${p.ok ? "ok" : "FAIL"} ${p.name} ${p.url} ${extra} ${p.ms}ms`;
    });
  return [
    value.advice,
    "",
    "env:",
    ...envLines.map((l) => `  ${l}`),
    "",
    "probes:",
    ...probeLines.map((l) => `  ${l}`),
  ].join("\n");
}
