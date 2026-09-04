import {
  buildAdvice,
  buildFix,
  formatReport,
  inspectDshWebEnv,
  probeProxyListen,
  readEnv,
  redactEnv,
  registryProbeList,
  withChildProxyEnv,
} from "./lib/net.js";

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
      "Use the net_doctor tool when DeepSeek API, Search, npm, ModelScope, or other HTTPS calls fail from this agent (TypeError: fetch failed is common).",
      "The browser on Windows can work while WSL Node fetch does not: Node 24 ignores HTTP_PROXY unless NODE_USE_ENV_PROXY=1.",
      injectChildProxy
        ? "This plugin also sets NODE_USE_ENV_PROXY=1 (and lowercase http_proxy aliases) on bash/npm child processes."
        : "Child bash/npm processes may still need NODE_USE_ENV_PROXY=1 even when this dsh process has it.",
      "Prefer dsh-wsl-kit scripts/restart-dsh-web.sh after fixing proxy. Do not guess proxy URLs; read advice and fix.scripts.",
    ].join(" "),
  });

  ctx.tools.register({
    name: "net_doctor",
    description: "Diagnose WSL/Windows proxy and Node 24 fetch: reports HTTP_PROXY, NODE_USE_ENV_PROXY, probes DeepSeek/npm/ModelScope, and returns copy-paste fix scripts when something is wrong. Use when network or API calls fail.",
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        target: {
          type: "string",
          enum: ["all", "env", "deepseek", "npm", "registry", "modelscope", "huggingface"],
          description: "What to check. Default all: env plus DeepSeek, npm, and ModelScope probes. registry = npm + ModelScope.",
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          advice: { type: "string" },
          fix: {
            type: "object",
            additionalProperties: false,
            properties: {
              steps: { type: "array", items: { type: "string" } },
              scripts: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    shell: { type: "string" },
                    code: { type: "string" },
                  },
                },
              },
            },
          },
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
              ALL_PROXY: { type: "string" },
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
          proxyListen: {
            type: "object",
            additionalProperties: false,
            properties: {
              configured: { type: "boolean" },
              open: { type: "boolean" },
              url: { type: "string" },
              host: { type: "string" },
              port: { type: "integer" },
              error: { type: "string" },
            },
          },
          dshWeb: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: formatReport(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = typeof args?.target === "string" ? args.target : "all";
      const allowed = new Set(["all", "env", "deepseek", "npm", "registry", "modelscope", "huggingface"]);
      const selected = allowed.has(target) ? target : "all";
      const env = readEnv();
      const probes = [];
      if (selected === "all" || selected === "deepseek") {
        probes.push(await probe("deepseek", "https://api.deepseek.com/", exec.signal, probeTimeoutMs));
      }
      for (const spec of registryProbeList(env, selected)) {
        probes.push(await probe(spec.name, spec.url, exec.signal, probeTimeoutMs));
      }
      const proxyListen = await probeProxyListen(env, { timeoutMs: Math.min(probeTimeoutMs, 2000) });
      const dshWeb = inspectDshWebEnv();
      const dshWebOut = dshWeb.env
        ? { ok: dshWeb.ok, pid: dshWeb.pid, error: dshWeb.error || "", env: redactEnv(dshWeb.env) }
        : { ok: dshWeb.ok, pid: dshWeb.pid, error: dshWeb.error || "", env: null };
      return {
        advice: buildAdvice(env, probes, selected, injectChildProxy, proxyListen, dshWeb),
        fix: buildFix(env, probes, injectChildProxy),
        env: redactEnv(env),
        probes,
        proxyListen,
        dshWeb: dshWebOut,
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

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
