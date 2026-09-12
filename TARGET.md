# Target (AEP 2.8.6)

AEP 2.8.6 is a protocol library and a local kernel whose public writing policy name is CORRECTWRITING_EN, with Docker as the first operator path, source build as secondary and above-floor design treated as a defect.

## ISA and OS

The floor is Linux on x86_64 while the ceiling is Linux on x86_64 and aarch64.

## RAM and cores

RAM floor is 2 GiB and RAM ceiling is 8 GiB for the public compose service, with core floor 2 and core ceiling 4. A design that needs more than 2 GiB or 2 cores for Admit of a sealed capsule is a defect.

## Disk and net

Disk floor is 4 GiB for image plus data and disk ceiling is 20 GiB, with net floor loopback only and net ceiling a private bind with a setup token.

## GPU

GPU is no because Admit does not use a GPU.

## RSS and latency

RSS floor for Base Node plus UCB is 256 MiB and RSS ceiling is 512 MiB, while dock collect latency after the compiled 1000 ms pulse is 50 ms p99 ceiling and hot path p99 is 1 ms ceiling. Above-floor design is a defect.
