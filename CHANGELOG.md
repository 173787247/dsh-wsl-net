## 0.5.2

- Detect risky Clash RFC1918/wildcard NO_PROXY; advise restart-dsh-web.sh loopback-only.

# Changelog

## 0.5.1

- Inspect running `dsh web` `/proc/<pid>/environ` for proxy / `NODE_USE_ENV_PROXY` (alongside tool-process env).
- Advice when the host process lacks `NODE_USE_ENV_PROXY=1` while the proxy port is open; points at kit `restart-dsh-web.sh` / `check-dsh-health.sh`.

## 0.5.0

- TCP-probe configured `HTTP(S)_PROXY` port (`proxyListen`).
- Stronger advice for DeepSeek Search `TypeError: fetch failed` / missing `NODE_USE_ENV_PROXY=1`.
- Fix scripts prefer `dsh-wsl-kit/scripts/restart-dsh-web.sh`.

## 0.4.0

- Registry probes (ModelScope / Hugging Face) and richer fix scripts.
