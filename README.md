# dsh-wsl-net

DeepSeek Harness **tool** plugin: `net_doctor` diagnoses why HTTPS works in the Windows browser but fails from the WSL agent—and returns **copy-paste fix scripts**.

Pairs with [dsh-wsl-env](https://github.com/173787247/dsh-wsl-env). Part of **[dsh-wsl-kit](https://github.com/173787247/dsh-wsl-kit)**.

[中文说明 ↓](#中文)

---

## English

### Why

Clash / V2Ray often runs on Windows with `HTTP_PROXY=http://127.0.0.1:…`. Node **24** `fetch` ignores proxy env vars unless `NODE_USE_ENV_PROXY=1`. The browser can look fine while the agent cannot reach DeepSeek or npm.

### What it does

- Reports `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` (userinfo redacted), `NODE_USE_ENV_PROXY`, optional npm registry
- Probes DeepSeek API and the npm registry (HTTP status &lt; 500 counts as reachable, including 401)
- Returns `advice` plus `fix.steps` / `fix.scripts` (reuses current proxy when set; otherwise a `127.0.0.1:7890` template you must edit)
- Optionally injects `NODE_USE_ENV_PROXY=1` and lowercase `http_proxy` aliases into bash/npm **child** processes (`injectChildProxy`)

Does **not** print API keys, change Clash ports, or invent a proxy URL when none is configured.

### Install

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-net
```

Restart `dsh web`. In a new session, Tools should list `net_doctor`. Example ask: “Check whether DeepSeek API and npm are reachable.”

Child injection check:

```sh
node -e "console.log(process.env.NODE_USE_ENV_PROXY, process.env.http_proxy || process.env.HTTP_PROXY)"
```

Expect `1` and your proxy URL when a child bash/npm is wrapped.

### Tool parameters

| Arg | Values | Meaning |
|-----|--------|---------|
| `target` | `all` (default), `env`, `deepseek`, `npm` | What to check |

### Config

```yaml
- id: dsh-wsl-net
  name: dsh-wsl-net
  config:
    timeoutMs: 20000
    probeTimeoutMs: 5000
    injectChildProxy: true
```

| Key | Default | Meaning |
|-----|---------|---------|
| `timeoutMs` | `20000` | Tool timeout |
| `probeTimeoutMs` | `5000` | Per-probe timeout |
| `injectChildProxy` | `true` | Wrap `subprocess.spawn` / `spawnTerminal` |

### Changelog (short)

- **0.3.0** — `fix` copy-paste scripts
- **0.2.x** — child proxy injection; redact proxy userinfo; `ALL_PROXY`

### Test

```sh
npm test
```

### License

MIT

---

## 中文

### 为什么需要

代理在 Windows、Agent 在 WSL 时，浏览器能上网，但 Node 24 的 `fetch` 默认不读 `HTTP_PROXY`，除非设置 `NODE_USE_ENV_PROXY=1`。本工具在会话里实测代理与连通性，并给出可复制的修复脚本。

### 功能

- 报告代理环境变量（隐藏 userinfo）、`NODE_USE_ENV_PROXY`、可选 npm registry
- 探测 DeepSeek 与 npm
- 返回 `advice` 与 `fix`（有代理则复用；无代理给 `7890` 模板并注明需改）
- 可选：给 bash/npm 子进程注入 `NODE_USE_ENV_PROXY=1`

不会打印 API Key，也不会擅自改 Clash 端口。

### 安装与验证

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-net
```

重启后新会话应出现工具 `net_doctor`。让 Agent「检查 DeepSeek 和 npm 通不通」即可。

### 配置

| 键 | 默认 | 含义 |
|----|------|------|
| `timeoutMs` | `20000` | 工具超时 |
| `probeTimeoutMs` | `5000` | 单次探测超时 |
| `injectChildProxy` | `true` | 是否包装子进程环境 |

### 许可

MIT
