# dsh-wsl-net

DeepSeek Harness **tool** plugin: `net_doctor` diagnoses why HTTPS works in the Windows browser but fails from the WSL agent.

和 [dsh-wsl-env](https://github.com/173787247/dsh-wsl-env) 互补：那个往 prompt 里写路径事实，这个在会话里**跑一遍**代理和连通性。

常见原因：Clash 在 Windows 上、`HTTP_PROXY` 指向 `127.0.0.1`，但 Node 24 的 `fetch` 默认不读代理变量，除非 `NODE_USE_ENV_PROXY=1`。

## Install

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-net
# or a local checkout:
dsh plugin --profile web add /absolute/path/to/dsh-wsl-net
```

Restart `dsh web`. In a **new** session, Trajectory → SYSTEM → **Tools** should list `net_doctor`. Ask: 「检查一下现在 DeepSeek API 和 npm 通不通」.

## What it reports

- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
- `NODE_USE_ENV_PROXY`
- optional npm registry
- GET probes: `https://api.deepseek.com/` and the npm registry (status &lt; 500 counts as reachable, including 401)
- `advice`: what to restart or set; it does not guess a Clash port

Does not print API keys. Does not change your proxy.

## Topics

On GitHub, add `dsh-plugin`.


## Config

Override the whole row in the profile `cordis.patch.yml`:

```yaml
- id: dsh-wsl-net
  name: dsh-wsl-net
  config:
    timeoutMs: 20000
    probeTimeoutMs: 5000
```
