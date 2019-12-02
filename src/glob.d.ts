// Glob
//
// pattern:
//   { term }
// term:
//   '*'         matches any sequence of non-Separator characters
//   '?'         matches any single non-Separator character
//   '[' [ '^' ] { character-range } ']'
//               character class (must be non-empty)
//   c           matches character c (c != '*', '?', '\\', '[')
//   '\\' c      matches character c

// character-range:
//   c           matches character c (c != '\\', '-', ']')
//   '\\' c      matches character c
//   lo '-' hi   matches character c for lo <= c <= hi

// Glob returns the names of all files matching pattern
export function glob(pattern :string) : string[]

// Match reports whether name matches the shell file name pattern
export function match(pattern :string, name :string) :boolean

// GlobError is the only error thrown by match and glob for malformed patterns.
export class GlobError extends Error {}
