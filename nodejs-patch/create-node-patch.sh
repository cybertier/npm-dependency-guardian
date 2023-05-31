#!/bin/bash

cd node
git add .
git diff --cached > ../node.patch
git restore --staged .
