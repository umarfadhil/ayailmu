# AyaIlmu API image of the local synthetic Compose stack (deploy/compose.yaml), built from backend/ with
# Dockerfile.dockerignore beside this file. No syntax directive: the builder's own Dockerfile frontend is used, so no
# frontend image is pulled. The builder is the pinned, already-cached official Go image; the only network the build may
# use is the public Go module proxy, for the exact versions go.sum pins (no toolchain download, no VCS, no other proxy).
# The runtime is scratch: the default-build ayailmu-api, ayailmu-migrate and ayailmu-ledger binaries (no Firebase or
# Google SDK), the builder's public CA bundle, and nothing else: no shell, package manager or secret. It runs as
# 65532:65532. The API and migration services run their own binary; only the restore drill's one-shots
# (deploy/restore) run the deletion-ledger operator tool.
FROM docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
ENV CGO_ENABLED=0 \
    GOFLAGS=-mod=readonly \
    GOTOOLCHAIN=local \
    GOPROXY=https://proxy.golang.org \
    GOSUMDB=sum.golang.org \
    GOPRIVATE= \
    GONOSUMDB=
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o /out/ayailmu-api ./cmd/ayailmu-api \
 && go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o /out/ayailmu-migrate ./cmd/ayailmu-migrate \
 && go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o /out/ayailmu-ledger ./cmd/ayailmu-ledger

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/ayailmu-api /ayailmu-api
COPY --from=build /out/ayailmu-migrate /ayailmu-migrate
COPY --from=build /out/ayailmu-ledger /ayailmu-ledger
USER 65532:65532
ENTRYPOINT ["/ayailmu-api"]
