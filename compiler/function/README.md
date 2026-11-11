# parcel rehosting

The parcel page and the background compiler call `parcels/rehost` in the Voxels sfo3 Functions namespace. Each invocation downloads, encodes and uploads at most eight features plus an optional tileset. Postgres, ownership checks and the final conditional save stay with the caller.

From the repo root, install dependencies and export the compiler's `UGC_ACCESS` and `UGC_SECRET`. Export `FULLBUCKET_ACCESS` and `FULLBUCKET_SECRET` to enable recovery from the old asset backups. The deploy script derives the function's authentication token from the UGC secret. The web server and compiler must have the same UGC secret. Redeploy the function when rotating it.

```sh
doctl serverless connect fn-7f487c48-1176-4b03-82aa-03c5faebe781
./compiler/function/deploy.sh
```

Deploy before rolling out callers. A failed function request leaves the parcel content and compilation timestamp untouched.
