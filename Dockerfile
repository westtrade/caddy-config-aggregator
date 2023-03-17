FROM node:alpine as build

WORKDIR /application
ADD . /application

RUN yarn 
RUN yarn build -t latest-linux-x64

FROM ubuntu
COPY --from=build /application/dist/caddy-config-aggregator /bin/caddy-config-aggregator