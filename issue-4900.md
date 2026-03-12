**Problem**

We want to shutdown local node, and enable solo usage across the board. One of the subgoals for solo is to able to work with solo in small developer laptops, with the lowest footprint possible and with a 10TPS kpi in mind

Nowadays solo default setup for relay is

```
rpcRelay:
    resources:
      requests:
        cpu: 0
        memory: 0
      limits:
        cpu: 500m
        memory: 1000Mi
```

**Solution**

Pick a reference test suite from the relay to test against
Test locally and within CI, the feasibility of reducing the memory

Tryouts

(1) Reduce to memory to 512m

- Testing locally and comparing test total run time vs the default setting
- Testing on CI, large runner, and comparing test total run time vs the default setting

(2)Reduce memory to 256m

- Testing locally and comparing test total run time vs the default setting and tryout1
- Testing on CI, large runner, and comparing test total run time vs the default setting, and tryout1

**DOD**

- Get results for the tryouts
- Share them on this issue
- Align next steps and possible improvements with @Ferparishuertas

Requirements change to the following:

Reduce memory required to support 100TPS TPS / 1000 Accounts with CN, BN, MN, and Relay (no TTv2 or TSS WRAPS) to 1 GB by the end of Q2 2026.

Reduce memory required to support 100 TPS / 1000 Accounts with CN, BN, MN, Relay, TTv2, and TSS WRAPS to 1 GB by the end of Q4 2026.

64 MB allocation per container.

Updated in main issue: https://github.com/hiero-ledger/solo/issues/3394
