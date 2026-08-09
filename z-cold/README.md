# z-cold

Drop-zone folder. Anything placed here is automatically committed and pushed
to this branch (`zcold`) of the PACT repo within a few seconds, by a
background sync script running on this machine (see `~/dev/zcold-sync`).

This branch is dedicated storage for dropped files only — it's kept
separate from `preview` so this folder stays available no matter what branch
you have checked out in your normal working copy. It's linked into your
normal `PACT` folder via a junction, so it looks and behaves like an
ordinary folder there.
