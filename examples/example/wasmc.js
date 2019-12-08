// config file

// lib({
//   sources: "*.c",
//   cflags: [ "-lolcat" ],
//   wasmc_flags: [ "-hello" ],
// })

module({
  name:    "foo",
  out:     builddir + "/foo.js",
  jsentry: "src/foo.js",
  jslib:   "src/lib.js",
  sources: "src/*.c",
  target:  "node",
  embed:   true,
  // ecma:    5,
  constants: {
    HELLO_WORLD: [1, 2+5, '3'],
  },
})

module({
  name:    "bar",
  sources: "src/bar.c",
  cflags: [ "-Wall" ],
  // embed:   true,
})
