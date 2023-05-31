#!/bin/bash

function yes_or_no {
    while true; do
        read -p "$* [y/n]: " yn
        case $yn in
            [Yy]*) return 0  ;;
            [Nn]*) echo "Aborted" ; exit ;;
        esac
    done
}

yes_or_no "Continuing will replace ALL CHANGES of the node directory with the contents of the node.patch file. Continue?"

cd node
git reset --hard HEAD
git clean -d -f
git apply ../node.patch
