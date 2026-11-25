# Base snapshot for one-sandbox-per-ticket agents, running the lightweight bunny stack
# natively (no Docker-in-Docker): Ruby, Node, postgres, redis, maildev and caddy, plus gh,
# Claude Code, Chromium and PrinceXML. Repos are cloned per sandbox by `bunny-stack setup`,
# not baked in.
FROM ubuntu:24.04

ARG RUBY_VERSION=3.4.13
ARG PG_VERSION=18
ARG CADDY_VERSION=2.11.4
ARG MAILDEV_VERSION=2.2.1
ARG PRINCE_VERSION=16
ENV DEBIAN_FRONTEND=noninteractive

# Base tools, Ruby build deps (with jemalloc for a smaller Rails footprint) and the native libs
# the api's gems need: libpq (pg), libxml2/libxslt (nokogiri), libvips (ruby-vips, loaded at boot).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg sudo jq unzip make openssl tzdata libnss3-tools \
      build-essential pkg-config autoconf bison \
      libssl-dev libyaml-dev zlib1g-dev libffi-dev libreadline-dev libgmp-dev libjemalloc-dev \
      libxml2-dev libxslt1-dev libvips42t64 \
      python3 python3-pip python3-pil \
      redis-server postgresql-common \
 && rm -rf /var/lib/apt/lists/*

# PostgreSQL 18 from the PGDG repo (Ubuntu 24.04 ships 16; the team's stack runs 18).
# The package creates the 18/main cluster on install.
RUN /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends "postgresql-${PG_VERSION}" libpq-dev \
 && rm -rf /var/lib/apt/lists/*

# Ruby, built once into the snapshot.
RUN git clone -q --depth 1 https://github.com/rbenv/ruby-build.git /tmp/ruby-build \
 && RUBY_CONFIGURE_OPTS="--with-jemalloc --disable-install-doc" \
    /tmp/ruby-build/bin/ruby-build "$RUBY_VERSION" /opt/ruby \
    || { tail -n 60 /tmp/ruby-build.*.log; exit 1; } \
 && rm -rf /tmp/ruby-build
ENV PATH="/opt/ruby/bin:${PATH}"

# Node 20 (app's .nvmrc), gh, maildev.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/* \
 && npm install -g "maildev@${MAILDEV_VERSION}" && npm cache clean --force

# PrinceXML for the api's PDFs (it runs `which prince`), with the font packages api/Dockerfile
# installs. The licence and the api's own fonts come from the api repo in Dockerfile.warm.
RUN curl -fsSL -o /tmp/prince.deb \
      "https://www.princexml.com/download/prince_${PRINCE_VERSION}-1_ubuntu24.04_$(dpkg --print-architecture).deb" \
 && apt-get update && apt-get install -y --no-install-recommends \
      /tmp/prince.deb fontconfig fonts-dejavu fonts-freefont-ttf \
 && rm -rf /tmp/prince.deb /var/lib/apt/lists/*

# Caddy, in place of kong.
RUN arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${arch}.tar.gz" \
    | tar -xz -C /usr/local/bin caddy

# Agent user with passwordless sudo; gems go to its home, owned by it.
RUN (id -u daytona >/dev/null 2>&1 || useradd -m -s /bin/bash daytona) \
 && echo 'daytona ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/daytona \
 && echo 'Defaults secure_path="/opt/ruby/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' > /etc/sudoers.d/path

# Chromium + its system deps for browser checks (Playwright's build).
RUN npx -y playwright@1 install-deps chromium && rm -rf /var/lib/apt/lists/*
USER daytona
RUN npx -y playwright@1 install chromium \
 && curl -fsSL https://claude.ai/install.sh | bash \
 && rm -rf /home/daytona/.npm
ENV PATH="/home/daytona/.local/bin:${PATH}"
USER root

COPY stack/ /opt/bunny-stack/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /opt/bunny-stack/bunny-stack /opt/bunny-stack/bunny-infra \
 && ln -s /opt/bunny-stack/bunny-stack /usr/local/bin/bunny-stack \
 && ln -s /opt/bunny-stack/bunny-infra /usr/local/bin/bunny-infra \
 && ln -s /opt/bunny-stack/proxy-env.sh /etc/profile.d/bunny-proxy-env.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
