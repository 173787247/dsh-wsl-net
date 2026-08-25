export function pickEnv(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (value) return value;
  }
  return "";
}

export function readEnv(env = process.env) {
  return {
    HTTP_PROXY: pickEnv(env, "HTTP_PROXY", "http_proxy"),
    HTTPS_PROXY: pickEnv(env, "HTTPS_PROXY", "https_proxy"),
    NO_PROXY: pickEnv(env, "NO_PROXY", "no_proxy"),
    NODE_USE_ENV_PROXY: env.NODE_USE_ENV_PROXY ?? "",
    npm_config_registry: env.npm_config_registry ?? "",
    WSL_DISTRO_NAME: env.WSL_DISTRO_NAME ?? "",
  };
}

export function childProxyEnv(env = process.env) {
  const extra = {};
  const http = env.HTTP_PROXY || env.http_proxy;
  const https = env.HTTPS_PROXY || env.https_proxy;
  const noProxy = env.NO_PROXY || env.no_proxy;
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
  extra.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY === "0" ? "0" : "1";
  return extra;
}

export function withChildProxyEnv(spec, env = process.env) {
  if (!spec || typeof spec !== "object") return spec;
  return {
    ...spec,
    env: {
      ...childProxyEnv(env),
      ...spec.env,
    },
  };
}

export function proxyOn(env) {
  return Boolean(env.HTTP_PROXY || env.HTTPS_PROXY);
}

export function proxyHonored(env) {
  return env.NODE_USE_ENV_PROXY === "1";
}

export function buildAdvice(env, probes, target, injectChildProxy) {
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

export function formatReport(value) {
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
