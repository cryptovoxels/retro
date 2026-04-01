# Base for devcontainer features. psql via apt (postgres feature fails to pull on some Codespaces hosts).
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

USER root

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

USER vscode