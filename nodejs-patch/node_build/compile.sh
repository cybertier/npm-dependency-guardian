#!/bin/sh

# change working directory to this scripts directory for working relative paths
DIRNAME=${BASH_SOURCE[0]%/*}
cd $DIRNAME

sudo docker run --network none -v $(realpath ../node):/node nodebuilder
