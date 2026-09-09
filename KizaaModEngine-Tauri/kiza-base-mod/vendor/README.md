# Vendored libraries

## asm-9.7.jar

- **What** — [ASM](https://asm.ow2.io/), the bytecode library Fabric, Forge and
  Mixin all build on.
- **Licence** — BSD 3-Clause, © INRIA, France Telecom. Redistribution in binary
  form is permitted; the notice travels inside the jar.
- **From** — `https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar`
- **SHA-1** — `073d7b3086e14beb604ced229c302feff6449723`, matching the `.sha1`
  Maven Central publishes beside it.

### Why it is here

Only the Vanilla agent uses it, and only to place two calls into
`Screen.render` -- the same two a Mixin declares on every other loader. A plain
Minecraft has no loader to declare them to, so they are written into the class
as it loads.

The alternative was editing class files by hand. That is possible, and it is a
constant pool editor to write and maintain: inserting instructions shifts every
offset after them, and a stack map that no longer matches its code is not a bug
that misbehaves, it is a `VerifyError` on somebody else's computer. A hundred
and twenty kilobytes under a permissive licence is the better trade.

### What links it

The five loader jars do not. Their Mixins already do this work, and none of
them gains a byte from this file. Only `kiza-base-mod-vanilla-agent.jar`
carries ASM's classes, where nothing else can collide with them: on a plain
Minecraft there is no other copy of ASM in memory.
