FROM node:22-slim

RUN apt-get update && apt-get install -y curl ca-certificates git && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://claude.ai/install.sh | bash -s stable

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace
COPY server.js /workspace/server.js

EXPOSE 4000
# --watch (Node 22+) riavvia automaticamente il processo quando server.js cambia,
# utile insieme al bind mount in docker-compose per evitare rebuild ad ogni modifica.
CMD ["node", "--watch", "/workspace/server.js"]
