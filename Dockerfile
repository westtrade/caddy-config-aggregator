FROM node:alpine as build

WORKDIR /application
ADD . /application

RUN yarn 
RUN yarn build -t latest-linux-x64