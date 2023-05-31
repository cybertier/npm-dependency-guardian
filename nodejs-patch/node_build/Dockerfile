FROM ubuntu:focal

RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install -y python3 g++ make python3-pip ninja-build
COPY make.sh /make.sh
RUN chmod +x /make.sh

# don't compile as root
RUN useradd -u 1000 user
RUN chown user:user /make.sh
USER user

ENTRYPOINT ["/make.sh"]
