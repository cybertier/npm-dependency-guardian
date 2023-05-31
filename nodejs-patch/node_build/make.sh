#!/bin/sh

cd /node
./configure --ninja
JOBS=$(nproc) make
