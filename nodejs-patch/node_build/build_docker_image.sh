#!/bin/sh

# change working directory to this scripts directory for working relative paths
DIRNAME=${BASH_SOURCE[0]%/*}
cd $DIRNAME

sudo docker build . -t nodebuilder
