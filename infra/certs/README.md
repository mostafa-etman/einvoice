# Local TLS certificates (mkcert)



This directory holds Traefik TLS certificates for local HTTPS. Generated files

are gitignored.



**Source of truth (filenames + SANs):** Traefik loads exactly these files via

`infra/traefik/dynamic/routes.yml`:



| File | Purpose |

|------|---------|

| `localhost.pem` | TLS certificate |

| `localhost-key.pem` | Private key |



**Required Subject Alternative Names (SANs):**



- `localhost`

- `*.localhost`

- `api.localhost`

- `web.localhost`



Do **not** rely on mkcert’s default `web.localhost+4.pem` naming — Traefik will

not find those files and HTTPS will fail with a blank/default cert.



## Prerequisites



1. Install [mkcert](https://github.com/FiloSottile/mkcert)

2. Install the local CA into the **Windows** trust store (must be run in an

   elevated terminal on first setup):



```powershell

mkcert -install

```



Verify CA location:



```powershell

mkcert -CAROOT

```



## Generate certificates (Windows PowerShell)



From the repository root:



```powershell

cd infra/certs

mkcert -cert-file localhost.pem -key-file localhost-key.pem `

  "localhost" "*.localhost" "api.localhost" "web.localhost"

```



Git Bash / WSL / macOS / Linux:



```bash

cd infra/certs

mkcert -cert-file localhost.pem -key-file localhost-key.pem \

  "localhost" "*.localhost" "api.localhost" "web.localhost"

```



Verify SANs (Windows):



```powershell

certutil -dump localhost.pem | Select-String "DNS Name"

```



## Trust the CA (Windows 10 + browsers)



1. **Install CA (once):** `mkcert -install` in an **Administrator** PowerShell

   window. This adds mkcert’s root CA to the Windows trust store; Chrome and

   Edge use it automatically.

2. **Regenerate cert files** if you previously used mkcert default names

   (`web.localhost+4.pem`) or SANs are wrong — see commands above.

3. **Restart Traefik** so it reloads the PEM files from the mounted volume:



```powershell

pnpm infra:down

pnpm infra:up

```



4. **Fully quit and reopen your browser** (all windows). A normal tab refresh

   is not enough after CA or cert changes.



### Firefox caveat



Firefox does not always use the Windows trust store. Either:



- Set `about:config` → `security.enterprise_roots.enabled` → `true`, **or**

- Import the mkcert root CA manually from `%LOCALAPPDATA%\mkcert` (run

  `mkcert -CAROOT` to find the folder) via Firefox Settings → Privacy &

  Security → Certificates → View Certificates → Authorities → Import.



## Hosts



Ensure these resolve to `127.0.0.1` (most OS map `*.localhost` automatically):



- `web.localhost`

- `api.localhost`



## Traefik wiring (reference)



- **Volume:** `./certs:/certs:ro` in `infra/docker-compose.yml`

- **TLS config:** `infra/traefik/dynamic/routes.yml` → `tls.certificates`

- **Routers:** `Host(`web.localhost`)` → `host.docker.internal:3000`,

  `Host(`api.localhost`)` → `host.docker.internal:3001`

- **HTTP → HTTPS:** port 80 redirects to 443 (`infra/traefik/traefik.yml`)



## Verify HTTPS end-to-end



With infra and apps running (`pnpm infra:up`, `pnpm dev:api`, `pnpm dev:web`):



```powershell

# Traefik should load the cert without errors

docker logs infra-traefik-1 2>&1 | Select-String "localhost.pem"



# API readiness (expect JSON, no TLS warning in browser)

curl.exe -v https://api.localhost/health/ready



# Web landing (expect 200 or 308 to /en or /ar)

curl.exe -I https://web.localhost/en

```



In the browser, open `https://web.localhost/ar` and `https://api.localhost/health/ready`

— the address bar should show a **valid (green lock)** certificate with no

“Not secure” warning.



## Troubleshooting



| Symptom | Likely cause | Fix |

|---------|--------------|-----|

| Traefik log: `failed to find any PEM data` | Wrong/missing filenames | Regenerate `localhost.pem` / `localhost-key.pem` |

| Browser “Not secure” but Traefik OK | CA not trusted or stale browser cache | `mkcert -install`, restart browser; Firefox: enterprise roots |

| Connection refused | Apps not running on host | `pnpm dev:api` / `pnpm dev:web` |

| 404 from Traefik | Wrong Host header | Use `web.localhost` / `api.localhost`, not bare `localhost` |

