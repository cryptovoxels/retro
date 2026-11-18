# stats.voxels.com

The stats hostname serves the dashboard from the existing web service. The data endpoint at www.voxels.com/api/admin/network checks the existing Voxels team session. Refresh is every five seconds, or every minute for the 30-day view.

# Voxels request monitor

Import requests.ndjson in OpenSearch Dashboards under Management > Saved Objects.
"Voxels / deploy watch" refreshes every five seconds. Click through to Discover to
inspect individual requests. Filter by deploy, service, status, route or UGC asset.
The lag panel measures completion to ingestion. Search refresh and dashboard refresh
add latency after ingestion.

"Voxels / daily network errors (UTC)" counts HTTP 4xx, 5xx and incomplete responses
once per service request. Redirects count as requests. Internal calls and redirects
can produce multiple requests for one player action. The current UTC day is partial.
Use comparable traffic coverage throughout the campaign.

## connect

1. Select a managed OpenSearch plan in sfo3 and connect retrovoxels to the same
   VPC. Allow the app's VPC traffic to the cluster. Use the private endpoint.
2. Run setup.http in OpenSearch Dashboards Dev Tools. This creates the write alias,
   mappings, ingest pipeline and 30-day index lifecycle. Check
   `GET _plugins/_ism/explain/voxels-requests-*` after the first writes.
   Expiry is per index on the management schedule. Managed backups expire separately.
3. Give the app a writer with bulk/create permissions restricted to the
   voxels-requests alias and its backing indices. Set runtime secrets
   REQUEST_SEARCH_AUTH (user:password) and REQUEST_SEARCH_CA (PEM certificate),
   plus REQUEST_SEARCH_URL (private HTTPS endpoint without credentials).
   Set REQUEST_DEPLOY to the component binding `${_self.COMMIT_HASH}` or the image release.
4. Deploy the instrumented HTTP services. Each replica sends batches in the
   background. Look for every expected service in Discover and compare the counts
   against App Platform Insights. A backlog or dropped-event warning means a
   gap in coverage. Abrupt restarts can lose queued events. REQUEST_STDOUT=1
   also emits individual JSON records for checking a component.
5. Record the first complete UTC day's error count with all intended sources
   reporting, ideally before releasing the texture fix. Run
   `python3 dashboard.py DAILY_ERROR_COUNT > /tmp/voxels-dashboard.ndjson`
   and import it with overwrite enabled. The daily chart now shows a fixed
   target at 1% of that count even after baseline events expire. Compare complete
   days and check daily volume before attributing a reduction to a deploy.

## coverage

The private writer covers HTTP responses on the web, multiplayer, compressor,
renderer and compiler services. It records route templates, duration, completion,
status, deploy and request ID. The asset field allows parcel image keys only.

Engine Function requests use the compressor gateway, which records their status, parcel image and latency as service `function`. Direct calls to the standalone Function also write events to its invocation logs.
Functions cannot attach to the app's VPC. Its logs need a separate importer before
they appear on this dashboard. Spaces/CDN access logs also need a separate import;
they arrive asynchronously. App Platform Insights provides a separate cross-check
for errors at the edge before a request reaches the service. WebSocket frames and
browser-only failures such as an HTTP/2 stream breaking after a 200 are outside
the service request count.
