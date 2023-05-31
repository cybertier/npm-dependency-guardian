# Usage

All the steps assume that this is your current working directory.
The only tested NodeJS version is v18.0.0, as checked out in the `./node` submodule.

## Creating and restoring patches

### Create patch from changes in the `node` submodule

```sh
./create-node-patch.sh
```

Will *overwrite* the file `./node.patch` with the current diff of the `./node` submodule

### Apply patch from the `./node.patch` file

```sh
./apply-node-patch.sh
```

This will *overwrite* all current changes in the `./node` submodule with the changes currently stored in the `./node.patch` file.

## Building the (patched) NodeJS binary

### Build the docker image

```sh
node_build/build_docker_image.sh
```

This will build the `nodebuilder` docker image.

### Compile the binary

```sh
node_build/compile.sh
```

This will compile the NodeJS interpreter from the current state of the `./node` submodule inside the `nodebuilder` docker container.
The resulting binary is placed in `./node/out/Release/node`, with a symlink being present at `./node/node`.
