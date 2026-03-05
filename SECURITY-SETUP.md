# Security Setup Guide

Step-by-step instructions for tools that require manual installation or configuration.

---

## 1. Pre-push Hooks (pre-commit framework)

The pre-commit framework runs security checks automatically before every `git push`.

### Install pre-commit

```bash
# Fedora / RHEL
sudo dnf install pre-commit

# macOS
brew install pre-commit

# Any platform with Python
pip install pre-commit
```

### Install the hooks

Run this once from the project root:

```bash
pre-commit install --hook-type pre-push
```

This creates a `.git/hooks/pre-push` script that runs the checks defined in `.pre-commit-config.yaml`.

### Test the hooks

Run all hooks manually without pushing:

```bash
pre-commit run --all-files --hook-stage pre-push
```

### Update hook versions

```bash
pre-commit autoupdate
```

This updates the `rev:` versions in `.pre-commit-config.yaml` to the latest releases.

---

## 2. Local Tool Installation

Some hooks require tools installed on your system.

### Trivy (vulnerability scanner)

```bash
# Fedora / RHEL
sudo dnf install trivy

# macOS
brew install trivy

# Any Linux (install script)
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
```

Verify: `trivy --version`

### Semgrep (SAST)

```bash
# Any platform with Python
pip install semgrep

# macOS
brew install semgrep
```

Verify: `semgrep --version`

### Gitleaks (secret scanner)

```bash
# Fedora / RHEL
sudo dnf install gitleaks

# macOS
brew install gitleaks
```

Verify: `gitleaks version`

---

## 3. Docker Bench for Security

Docker Bench checks your Docker host configuration against the CIS Docker Benchmark -- a set of industry-standard security best practices for running containers.

This is a **periodic manual scan** you run on your production server. It is not automated in CI because it audits the Docker host, not the project code.

### What it checks

- Docker daemon configuration (TLS, logging, resource limits)
- Container runtime settings (capabilities, read-only filesystems, PID limits)
- Image security (trust, vulnerability scanning)
- Network configuration (inter-container communication, bridge network)
- Host OS hardening (kernel parameters, file permissions)

### How to run it

SSH into your server and run:

```bash
docker run --rm --net host --pid host --userns host --cap-add audit_control \
    -e DOCKER_CONTENT_TRUST=$DOCKER_CONTENT_TRUST \
    -v /var/lib:/var/lib:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v /etc:/etc:ro \
    docker/docker-bench-security
```

### Reading the output

- **[PASS]** -- configuration meets the benchmark
- **[WARN]** -- configuration should be reviewed and potentially changed
- **[INFO]** -- informational, no action needed
- **[NOTE]** -- something to be aware of

Focus on **[WARN]** items first. Not every warning needs to be fixed -- some are trade-offs (e.g., enabling `--userns-remap` can break volume permissions). Evaluate each warning in the context of your deployment.

### Recommended schedule

Run Docker Bench after:
- Initial server setup
- Docker version upgrades
- Changes to docker-compose.yml or Dockerfiles
- Quarterly as a routine check

---

## 4. GitHub Secret Scanning

GitHub Secret Scanning automatically detects accidentally committed secrets (API keys, tokens, passwords) in your repository. This is complementary to Gitleaks -- GitHub scans server-side, Gitleaks scans client-side before push.

### How to enable it

1. Go to your repository on GitHub
2. Click **Settings** (gear icon)
3. In the left sidebar, click **Code security**
4. Under **Secret scanning**, click **Enable**

### Enable push protection (recommended)

Push protection blocks pushes that contain detected secrets before they enter the repository history.

1. On the same **Code security** settings page
2. Under **Secret scanning**, find **Push protection**
3. Click **Enable**

When push protection blocks a push, you will see a message explaining which secret was detected. You can then remove the secret from your commit before pushing again.

### What it detects

GitHub partners with service providers (AWS, Google Cloud, Slack, npm, etc.) to detect their token formats. It covers:
- Cloud provider credentials (AWS, GCP, Azure)
- API keys and tokens (GitHub, Slack, Stripe, npm, etc.)
- Database connection strings with embedded passwords
- Private keys (SSH, PGP)

### Notifications

When a secret is detected, GitHub:
- Alerts repository admins via email
- Shows the alert in **Settings > Code security > Secret scanning alerts**
- For partnered patterns, may automatically revoke the leaked credential with the provider
