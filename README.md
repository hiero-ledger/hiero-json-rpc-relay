<div align="center">

# Hedera JSON RPC Relay

[![Build](https://github.com/hiero-ledger/hiero-json-rpc-relay/actions/workflows/test.yml/badge.svg)](https://github.com/hiero-ledger/hiero-json-rpc-relay/actions)
[![Latest Version](https://img.shields.io/github/v/tag/hiero-ledger/hiero-json-rpc-relay?sort=semver&label=version)](README.md)
[![RPC API Methods](https://img.shields.io/badge/api-docs-green.svg)](docs/rpc-api.md)
[![RPC API Methods](https://img.shields.io/badge/websocket-docs-green.svg)](docs/live-events-api.md)
[![Discord](https://img.shields.io/badge/discord-join%20chat-blue.svg)](https://hedera.com/discord)
[![Made With](https://img.shields.io/badge/made_with-typescript-blue)](https://github.com/hiero-ledger/hiero-json-rpc-relay/)
[![License](https://img.shields.io/badge/license-apache2-blue.svg)](LICENSE)

</div>

## Overview

Implementation of an Ethereum JSON RPC APIs for Hedera Hashgraph. Utilises both Hedera Consensus Nodes and Mirror nodes
to support RPC queries as defined in
the [JSON RPC Specification](https://playground.open-rpc.org/?schemaUrl=https://raw.githubusercontent.com/hiero-ledger/hiero-json-rpc-relay/main/docs/openrpc.json&uiSchema%5BappBar%5D%5Bui:splitView%5D=false&uiSchema%5BappBar%5D%5Bui:input%5D=false&uiSchema%5BappBar%5D%5Bui:examplesDropdown%5D=false)

## Building

### Pre-requirements

You must have installed

- [node (version 20)](https://nodejs.org/en/about/)
- [npm](https://www.npmjs.com/)
- [pnpm](https://pnpm.io/)
- [Docker](https://docs.docker.com/engine/reference/commandline/docker/)

We also recommend installing the "prettier" plugin in IntelliJ.

### Steps

From the root of the project workspace:

1. Run `npm install`. This will create populate and link `node_modules`.
2. Run `npm run build`. This will clean and compile the relay library and the server.
3. Run `npm run start`. This will start the server on port `7546`.

Alternatively, after `npm install`, from within the IDE, you should see the `Start Relay Microservice`
run configuration. You should be able to just run that configuration, and it should start the server on port `7546`.

## Testing

### Best Practices

- It is highly recommended to read the [Testing Guide](docs/testing-guide.md) for detailed testing strategies and best practices.

### Postman

First ensure newman is installed locally using `npm`, then execute `newman`.

```shell
npm install -g newman
newman run packages/server/tests/postman.json --env-var baseUrl=http://localhost:7546
```

To enable Postman test to run via helm deployment add

```
test:
  enabled: true
  schedule: '@daily' #How often to run the Postman test
  baseUrl: "http://127.0.0.1:7546" # Relay URL to run the test against
```

### Acceptance Tests

The relay has a suite of acceptance tests that may be run to confirm E2E operation of the relay in either a `hedera-local-node` or deployed env.

#### Configuration

The JSON RPC Relay offers multiple environment variable configuration porperties to configure the relay for appropriate use.
More details can be found at [Configuration](/docs/configuration.md)
As in the case of a fully deployed relay the acceptance tests utilize the `.env` file. See the [Configuration](#configuration) for setup details.

Note: Read more about `DEV_MODE` which provides optimal local and developer testing configurations [here](docs/dev-mode.md)

The following table highlights some initial configuration values to consider

| Config            | Default | Description                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAIN_ID`        | `0x12a` | The network chain id. Local and previewnet envs should use `0x12a` (298). Previewnet, Testnet and Mainnet should use `0x129` (297), `0x128` (296) and `0x127` (295) respectively                                                                                                                                            |
| `HEDERA_NETWORK`  | ``      | Which network to connect to. Automatically populates the main node & mirror node endpoints. Can be `MAINNET`, `PREVIEWNET`, `TESTNET` or `OTHER`                                                                                                                                                                            |
| `MIRROR_NODE_URL` | ``      | The Mirror Node API endpoint. Official endpoints are Previewnet (https://previewnet.mirrornode.hedera.com), Testnet (https://testnet.mirrornode.hedera.com), Mainnet (https://mainnet-public.mirrornode.hedera.com). See [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api) |

#### Run

Tests may be run using the following command

```shell
npm run acceptancetest
```

## Deployment

The Relay supports Docker image building and Docker Compose container management using the provided [Dockerfile](Dockerfile) and [docker-compose](docker-compose.yml) files.

> **_NOTE:_** docker compose is for development purposes only.

### Bumping version

In order to bump version for all packages and files altogether there is an npm task called 'bump-version' that needs a parameter called `semver` and optional parameter `snapshot` with the version to bump and boolean respectively:

```
npm run bump-version --semver=0.21.0-rc1 --snapshot=true
```

`snapshot` parameter is `false` by default.

### Image Build (optional)

A new docker image may be created from a local copy of the repo.
Run the following command, substituting `<owner>` as desired

```shell
docker build -t <owner>/hedera-json-rpc-relay .
```

After building, the image may be tagged by running the following command, substituting `<version>` as desired

```shell
docker tag <owner>/hedera-json-rpc-relay:latest ghcr.io/hiero-ledger/hiero-json-rpc-relay:main
```

> **_NOTE:_** image is tagged using `ghcr.io/hiero-ledger/hiero-json-rpc-relay:main` to agree with [docker compose](docker-compose.yml). Modify build commands or file as needed.

### Configuration

The relay application currently utilizes [dotenv](https://github.com/motdotla/dotenv) to manage configurations.
Key values are pulled from a `.env` file and reference as `process.env.<KEY>` in the application.

To modify the default values

1. Rename [.env.example file](.env.example) to `.env`
2. Populate the expected fields
3. Update the `relay` service volumes section in the [docker-compose](docker-compose.yml) file from `./.env.sample:/home/node/app/.env.sample` to `./.env:/home/node/app/.env`

Custom values provided will now be incorporated on startup of the relay

### Starting

To start the relay, a docker container may be created using the following command

```shell
docker compose up -d
```

> **_NOTE:_** If you encounter `unauthorized` when pulling image, then ensure you're logged in with `docker login ghcr.io` or use a [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) to authorize your login.

By default the relay will be made accessible on port `7546` and the websocket server - on port `8546`

#### Request Test

The following curl commands may be used to quickly test a running relay instance is function

From a command prompt/terminal run the command

```shell
curl -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"2","method":"eth_chainId","params":[null]}' http://localhost:7546
```

The expected response should be `{"result":"0x12a","jsonrpc":"2.0","id":"2"}`
Where the `result` value matches the .env `CHAIN_ID` configuration value or the current deault value of `298`

```shell
curl -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"2","method":"eth_gasPrice","params":[null]}' http://localhost:7546
```

The expected response should be of the form `{"result":"0x10bc1576c00","jsonrpc":"2.0","id":"2"}`
Where result returns a valid hexadecimal number

### Helm Chart

This repos `charts` directory contains the templates and values to deploy Hedera's json-rpc relay to a K8s cluster. This directory is packaged and distributed via helm repo.
To get started, first install the helm repo:

```
helm repo add hedera-json-rpc-relay https://hashgraph.github.io/hedera-json-rpc-relay/charts
helm repo update
```

now install the helm chart:

```
helm install [RELEASE_NAME] charts/hedera-json-rpc -f /path/to/values.yaml
```

To see the values that have been deployed:

```
helm show values hedera-json-rpc-relay
```

Deploy an installation with custom values file:

```
helm install custom-hedera-json-rpc-relay -f path/to/values/file.yaml ./charts/hedera-json-rpc --debug
```

##### Deploy Helm Chart locally on minikube

1.  Minikube must be running and the set context
2.  GHCR.io requires authorization to pull the image. This auth will require a Github PAT to be generated

- Acquire PAT, username, and, (primary) email address from Github.
- Manually create a secret on kubernetes with the following command. The $ must be replaced
  ```
  kubectl create secret docker-registry ghcr-registry-auth \
  --docker-server=https://ghcr.io \
  --docker-username=$GH_USERNAME \
  --docker-password=$GH_PAT \
  --docker-email=$GH_EMAIL
  ```

3. Deploy this helm chart with the addtional [environment/minikube.yaml](environment/minikube.yaml) file

```
helm upgrade -f environments/minkube.yaml jrpc-test ./
```

4. Port forward the pod IP to localhost

```
kubectl port-forward $POD_NAME 7546:7546
```

##### Monitoring

The hedera-json-rpc-relay ships with a metrics endpoint at `/metrics`. Here is an example scrape config that can be used by [prometheus](https://prometheus.io/docs/introduction/overview/):

```
        scrape_configs:
        - job_name: hedera-json-rpc
          honor_timestamps: true
          scrape_interval: 15s
          scrape_timeout: 10s
          scheme: http
          metrics_path: /metrics
          kubernetes_sd_configs:
            - role: pod
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_ip, __meta_kubernetes_pod_container_port_number ]
              action: replace
              target_label: __address__
              regex: ([^:]+)(?::\d+)?;(\d+)
              replacement: $1:$2
            - source_labels: [__meta_kubernetes_namespace]
              action: replace
              target_label: namespace
            - source_labels: [__meta_kubernetes_pod_name]
              action: replace
              target_label: pod
```

Please note that the `/metrics` endpoint is also a default scrape configurations for prometheus. The `job_name` of `kubernetes-pods` is generally deployed as a default with prometheus; in the case where this scrape_config is present metrics will start getting populated by that scrape_config and no other configurations are necessary.

##### Dashboard
[Grafana JSON Dashboards](https://github.com/hiero-ledger/hiero-json-rpc-relay/tree/main/charts/hedera-json-rpc-relay/dashboards) can be used as the dashboard for hedera-json-rpc-relay.

##### Admin-specific RPC methods

- GET `/config` - To provide more transparency and operational insight to the developers, the hiero-json-rpc-relay exposes all environment variables. Such information could aid in troubleshooting and understanding the context in which the relay is running.

Expected response:
```
{
    "relay": {
        "version": "0.67.0-SNAPSHOT",
        "config": {
            "CHAIN_ID": "0x128",
            "CLIENT_TRANSPORT_SECURITY": "false",
            "CONSENSUS_MAX_EXECUTION_TIME": "15000",
            ...
        }
    },
    "upstreamDependencies": [
        {
            "service": "consensusNode",
            "version": "0.59.3",
            "config": {
                "SDK_REQUEST_TIMEOUT": "10000"
            }
        },
        {
            "service": "mirrorNode",
            "config": {
                "MIRROR_NODE_AGENT_CACHEABLE_DNS": "true",
                "MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX": "200",
                "MIRROR_NODE_CONTRACT_RESULTS_PG_MAX": "25",
                ...
            }
        }
    ]
}
```

## Support

If you have a question on how to use the product, please see our
[support guide](https://github.com/hashgraph/.github/blob/main/SUPPORT.md).

## Contributing

Contributions are welcome. Please see the
[contributing guide](https://github.com/hashgraph/.github/blob/main/CONTRIBUTING.md)
to see how you can get involved.

## Code of Conduct

This project is governed by the
[Contributor Covenant Code of Conduct](https://github.com/hashgraph/.github/blob/main/CODE_OF_CONDUCT.md). By
participating, you are expected to uphold this code of conduct. Please report unacceptable behavior
to [oss@hedera.com](mailto:oss@hedera.com).

## License

[Apache License 2.0](LICENSE)
