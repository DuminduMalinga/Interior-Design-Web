# 07 Dependencies & supply chain

- **Pin exactly.** `backend/requirements.txt` is pinned; keep it so. Commit `package-lock.json`. Pin Deno imports.
- **Scan** on every PR and weekly: `pip-audit -r requirements.txt`, `npm audit --omit=dev`; turn on Dependabot alerts and security updates.
- **Patch SLA:** critical 48 h, high 7 days, medium 30 days.
- **Minimise:** remove unused packages. `backend/requirements.txt` is a developer file (it includes `pytest`); the container images use each
  service's own `requirements.txt`, which does not.
- **Containers:** pinned base image tags (digest in production), non-root user, rebuild monthly, scan with `trivy image`.
- **Model weights** (`best.pt`) are loaded from `/models` read-only. Load only weights you built or checksummed
  (keep a SHA-256 next to the file). Never `torch.load` an untrusted file: pickle can execute code.
- **CI/CD:** GitHub Actions use least-privilege `permissions:`, third-party actions pinned by commit SHA,
  and no secrets exposed to PR builds from forks.
- **Branch protection** on `main`: PR review required, no force pushes, status checks must pass.
