FROM node:22-bullseye@sha256:959fa6e5c12f4b08f58808f953c7a6a05f1f72629b57ef3a648b8809362fdad9

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /home/node/app/

COPY --chown=root:root --chmod=755 ./ ./

RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get autoremove -y && \
    apt-get install --no-install-recommends build-essential -y wget make g++ python3 && \
    npm ci --only=production --ignore-scripts && \
    npm cache clean --force --loglevel=error && \
    chown -R node:node . && \
    rm -rf /var/lib/apt/lists/*

USER node

RUN npm ci --ignore-scripts
RUN npx hardhat compile
