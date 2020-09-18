#!/bin/bash -e
cd "$(dirname "$0")/.."

VERSION=$(node -p 'require("./package.json").version')


# make sure there are no uncommitted changes to source code
if DIRTY_SRC=$(git status -uno --porcelain | grep -v "?? " | grep src/); then
  echo "There are uncommitted changes to source code:" >&2
  git status -s -uno >&2
  echo "Commit or revert these changes and run $0 again." >&2
  exit 1
else
  echo "git status check OK."
fi


# make sure version in package.json is different than latest released version
LATEST_VERSION=$(\
  curl -s -i https://unpkg.com/wasmc/package.json \
  | grep location \
  | sed -E 's/.*@([0-9.]+).*/\1/g')
if [[ "$LATEST_VERSION" == "$VERSION" ]]; then
  echo "version=${VERSION} in package.json is already published." >&2
  echo "Change the version in package.json and run $0 again." >&2
  exit 1
else
  echo "Version ${VERSION} check OK."
fi


# audit npm packages
echo "npm audit ..."
if ! (npm audit >/dev/null); then
  npm audit
  exit 1
fi
echo "npm audit OK."


# build
if [[ "$(find src -type f -newer wasmc)" != "" ]]; then
  bash misc/build.sh
  echo "Build OK."
else
  echo "Skipping build; wasmc is up to date. OK."
fi

# make sure it works
echo "Testing..."
echo ./wasmc -C examples/example -clean
     ./wasmc -C examples/example -clean >/dev/null 2>&1
echo "Test OK."

echo "----------------------------------------------------"

cat << _TXT_
To release a new distribution, run the following:

  git commit -m 'v${VERSION}' -- wasmc wasmc.map package.json
  bash misc/build.sh
  git commit --amend --no-edit wasmc wasmc.map
  git tag 'v${VERSION}'
  git push origin 'v${VERSION}' master
  npm publish .

_TXT_
