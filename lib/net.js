export function redactSecretUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "***";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^/?#]+)@/, "//***@");
  }
}

export function redactEnv(env) {
  const next = { ...env };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
    if (next[key]) next[key] = redactSecretUrl(next[key]);
  }
  return next;
}

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
    ALL_PROXY: pickEnv(env, "ALL_PROXY", "all_proxy"),
  };
}

export function childProxyEnv(env = process.env) {
  const extra = {};
  const http = env.HTTP_PROXY || env.http_proxy;
  const https = env.HTTPS_PROXY || env.https_proxy;
  const noProxy = env.NO_PROXY || env.no_proxy;
  const all = env.ALL_PROXY || env.all_proxy;
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
  if (all) {
    extra.ALL_PROXY = all;
    extra.all_proxy = all;
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
  return Boolean(env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY);
}

export function proxyHonored(env) {
  return env.NODE_USE_ENV_PROXY === "1";
}

export const REGISTRY_PROBES = {
  npm: { name: "npm", urlFromEnv: (env) => env.npm_config_registry || "https://registry.npmmirror.com/" },
  modelscope: { name: "modelscope", url: "https://www.modelscope.cn/" },
  huggingface: { name: "huggingface", url: "https://huggingface.co/" },
};

export function registryProbeList(env, target) {
  const probes = [];
  if (target === "all" || target === "npm" || target === "registry") {
    probes.push({ name: "npm", url: REGISTRY_PROBES.npm.urlFromEnv(env) });
  }
  if (target === "all" || target === "modelscope" || target === "registry") {
    probes.push({ name: "modelscope", url: REGISTRY_PROBES.modelscope.url });
  }
  if (target === "all" || target === "huggingface") {
    probes.push({ name: "huggingface", url: REGISTRY_PROBES.huggingface.url });
  }
  return probes;
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
  if (failed.some((p) => p.name === "modelscope" || p.name === "huggingface")) {
    lines.push("A registry probe failed (ModelScope/Hugging Face). Try net_doctor target=registry; domestic ModelScope often works without VPN while GitHub/npm may need proxy.");
  }
  return lines.join(" ");
}

/**
 * Copy-paste fix snippets for humans / agents. Never invents a proxy host/port —
 * only reuses values already present in env (redacted in reports via formatReport).
 */
export function buildFix(env, probes, injectChildProxy) {
  const steps = [];
  const scripts = [];
  const failed = probes.filter((p) => !p.ok);
  const proxyUrl = env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY || "";

  if (proxyOn(env) && !proxyHonored(env)) {
    steps.push("Restart the dsh process with NODE_USE_ENV_PROXY=1 so Node 24 fetch honors HTTP(S)_PROXY.");
    scripts.push({
      title: "restart-dsh-with-node-proxy",
      shell: "bash",
      code: [
        `export HTTP_PROXY=${shellQuote(proxyUrl)}`,
        `export HTTPS_PROXY=${shellQuote(env.HTTPS_PROXY || proxyUrl)}`,
        "export NODE_USE_ENV_PROXY=1",
        "dsh web",
      ].join("\n"),
    });
    if (injectChildProxy) {
      steps.push("Child bash/npm already get NODE_USE_ENV_PROXY=1 from this plugin; the dsh host process itself still needs the restart above.");
    }
  }

  if (!proxyOn(env) && failed.length > 0) {
    steps.push("Set HTTP_PROXY/HTTPS_PROXY to your Windows Clash/V2Ray mixed port (typical http://127.0.0.1:7890), then restart dsh with NODE_USE_ENV_PROXY=1.");
    scripts.push({
      title: "template-set-proxy-then-start-dsh",
      shell: "bash",
      code: [
        "# Replace 7890 with your Clash/V2Ray mixed port from the Windows tray app.",
        "export HTTP_PROXY=http://127.0.0.1:7890",
        "export HTTPS_PROXY=http://127.0.0.1:7890",
        "export NODE_USE_ENV_PROXY=1",
        "dsh web",
      ].join("\n"),
    });
  }

  if (proxyOn(env) && proxyHonored(env) && failed.length > 0) {
    steps.push("Proxy looks configured; verify the port is listening and that api.deepseek.com / the npm registry are allowed.");
    scripts.push({
      title: "recheck-with-net-doctor",
      shell: "bash",
      code: "# In chat, ask the agent to run net_doctor again after fixing the proxy app.",
    });
  }

  if (failed.length === 0 && probes.length > 0) {
    steps.push("No fix needed for HTTPS probes from this dsh process.");
  }

  if (steps.length === 0) {
    steps.push("No automatic fix suggested for this report.");
  }

  return { steps, scripts };
}

function shellQuote(value) {
  if (!value) return "''";
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export function formatReport(value) {
  const envLines = Object.entries(value.env).map(([k, v]) => `${k}=${v || "(empty)"}`);
  const probeLines = value.probes.length === 0
    ? ["(no probes)"]
    : value.probes.map((p) => {
      const extra = p.ok ? `status ${p.status}` : (p.error || `status ${p.status ?? "?"}`);
      return `${p.ok ? "ok" : "FAIL"} ${p.name} ${p.url} ${extra} ${p.ms}ms`;
    });
  const fix = value.fix || { steps: [], scripts: [] };
  const fixLines = [
    "fix:",
    ...fix.steps.map((s) => `  - ${s}`),
  ];
  if (fix.scripts.length > 0) {
    fixLines.push("  scripts:");
    for (const script of fix.scripts) {
      fixLines.push(`    # ${script.title} (${script.shell})`);
      for (const line of String(script.code).split("\n")) {
        fixLines.push(`    ${line}`);
      }
      fixLines.push("");
    }
  }
  return [
    value.advice,
    "",
    ...fixLines,
    "env:",
    ...envLines.map((l) => `  ${l}`),
    "",
    "probes:",
    ...probeLines.map((l) => `  ${l}`),
  ].join("\n").trimEnd();
}
