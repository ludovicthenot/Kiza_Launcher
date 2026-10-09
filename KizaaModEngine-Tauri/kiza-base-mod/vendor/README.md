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

## jcodec-0.2.5.jar, jcodec-javase-0.2.5.jar

- **What** — [JCodec](http://jcodec.org/), a video decoder written in pure Java.
- **Licence** — FreeBSD (2-clause BSD). Redistribution in binary form is
  permitted with the notice, which travels in `LICENSE-jcodec.txt` beside the
  relocated classes.
- **From** — `https://repo1.maven.org/maven2/org/jcodec/jcodec/0.2.5/jcodec-0.2.5.jar`
  and `.../jcodec-javase/0.2.5/jcodec-javase-0.2.5.jar`
- **SHA-1** — `0b1968a3dbf46aa5ac9630ce9e3cbf67c4940d08` and
  `924491879d101f60f659c0a26562b3c232f1c59d`, matching Maven Central.

### Why it is here

A video chosen as the title menu's background is decoded in the game. JCodec
is Java and nothing else: a broken file is an exception, never a crash in
native code. Only what an MP4 holding H.264 needs ships -- `tools/Shade.java`
follows the references from the demuxer, the decoder and the conversion to an
image, and copies those classes alone -- and it is renamed under
`fr.kiza.basemod.shaded`, so another mod carrying JCodec can never meet it.

## asm-commons-9.7.jar

- **What** — ASM's remapper, used at build time only, by `tools/Shade.java`.
  Never shipped.
- **Licence** — BSD 3-Clause, as ASM.
- **From** — `https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.7/asm-commons-9.7.jar`
- **SHA-1** — `e86dda4696d3c185fcc95d8d311904e7ce38a53f`, matching Maven Central.
