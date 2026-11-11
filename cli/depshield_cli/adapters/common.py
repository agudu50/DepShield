from dataclasses import dataclass


@dataclass(frozen=True)
class PackageCandidate:
    name: str
    version: str
