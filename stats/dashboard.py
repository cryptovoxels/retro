"""Print an OpenSearch Dashboards saved-object import. Optional argument: baseline errors/day."""
import json
import sys

baseline = float(sys.argv[1]) if len(sys.argv) > 1 else None
if baseline is not None and not 0 <= baseline < float('inf'):
    sys.exit('Supply a non-negative daily error count')
index = 'voxels-requests-*'
objects = []
panels = []
failure = {'bool': {'should': [{'range': {'status': {'gte': 400}}}, {'term': {'aborted': True}}], 'minimum_should_match': 1}}
errors = {'filter': failure}


def save(kind, key, attrs, refs=None):
    objects.append(dict(type=kind, id='voxels-' + key, attributes=attrs, references=refs or []))


def chart(key, title, aggs, mark, encoding, transform=None, target=None):
    spec = {'$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
            'data': {'url': {'%context%': True, '%timefield%': 'at', 'index': index, 'body': {'size': 0, 'aggs': aggs}},
                     'format': {'property': 'aggregations.rows.buckets'}},
            'transform': transform or [], 'mark': mark, 'encoding': encoding}
    if target is not None:
        spec['layer'] = [{'mark': spec.pop('mark'), 'encoding': spec.pop('encoding')},
                         {'mark': {'type': 'rule', 'strokeDash': [5, 3]}, 'encoding': {'y': {'datum': target}}}]
    save('visualization', key, {'title': title, 'visState': json.dumps({'title': title, 'type': 'vega', 'params': {'spec': json.dumps(spec)}, 'aggs': []}),
                                'uiStateJSON': '{}', 'kibanaSavedObjectMeta': {'searchSourceJSON': '{}'}})
    panels.append(('visualization', key))


def field(name, kind, title):
    return dict(field=name, type=kind, title=title)


def timeline(interval, zone='UTC'):
    return {'rows': {'date_histogram': {'field': 'at', 'fixed_interval': interval, 'time_zone': zone}, 'aggs': {'errors': errors}}}


def board(key, title, since, refresh):
    refs, layout = [], []
    for i, (kind, panel) in enumerate(panels):
        ref = 'panel_' + str(i)
        refs.append({'name': ref, 'type': kind, 'id': 'voxels-' + panel})
        layout.append({'panelRefName': ref, 'panelIndex': str(i), 'type': kind, 'embeddableConfig': {},
                       'gridData': {'i': str(i), 'x': i % 2 * 24, 'y': i // 2 * 14, 'w': 24, 'h': 14}})
    save('dashboard', key, {'title': title, 'panelsJSON': json.dumps(layout), 'optionsJSON': '{}', 'timeRestore': True,
                            'timeFrom': since, 'timeTo': 'now', 'refreshInterval': {'pause': False, 'value': refresh},
                            'kibanaSavedObjectMeta': {'searchSourceJSON': '{"query":{"language":"kuery","query":""},"filter":[]}'}}, refs)
    panels.clear()


save('index-pattern', 'requests', {'title': index, 'timeFieldName': 'at'})
time = field('key', 'temporal', 'time')
chart('seconds', 'failed requests per second', timeline('1s'), 'bar', {'x': time, 'y': field('errors.doc_count', 'quantitative', 'errors')})
chart('rate', 'error rate per minute', timeline('1m'), 'line',
      {'x': time, 'y': {**field('rate', 'quantitative', 'failed'), 'axis': {'format': '.1%'}}},
      [{'filter': 'datum.doc_count > 0'}, {'calculate': 'datum.errors.doc_count / datum.doc_count', 'as': 'rate'}])
chart('delay', 'p95 from request completion to ingestion', {'rows': {'date_histogram': {'field': 'at', 'fixed_interval': '1m'},
      'aggs': {'delay': {'percentiles': {'field': 'lag_ms', 'percents': [95], 'keyed': False}}}}},
      'line', {'x': time, 'y': field('lag', 'quantitative', 'milliseconds')}, [{'calculate': 'datum.delay.values[0].value', 'as': 'lag'}])
save('search', 'tail', {'title': 'latest requests', 'columns': ['service', 'deploy', 'method', 'route', 'status', 'aborted', 'ms', 'asset', 'id'],
     'sort': [['at', 'desc']], 'kibanaSavedObjectMeta': {'searchSourceJSON': json.dumps({'indexRefName': 'data', 'filter': [], 'query': {'language': 'kuery', 'query': ''}})}},
     [{'name': 'data', 'type': 'index-pattern', 'id': 'voxels-requests'}])
panels.append(('search', 'tail'))
board('deploys', 'Voxels / deploy watch', 'now-15m', 5000)

goal = baseline / 100 if baseline is not None else None
title = 'daily failures / baseline pending' if goal is None else f'daily failures / target {goal:g} per day'
chart('days', title, timeline('1d'), 'bar', {'x': time, 'y': field('errors.doc_count', 'quantitative', 'failed requests')}, target=goal)
chart('volume', 'daily request volume (UTC)', timeline('1d'), 'bar', {'x': time, 'y': field('doc_count', 'quantitative', 'requests')})
for key in ['route', 'service']:
    chart(key, 'failures by ' + key, {'rows': {'terms': {'field': key, 'size': 20, 'order': {'errors': 'desc'}}, 'aggs': {'errors': errors}}},
          'bar', {'y': {**field('key', 'nominal', key), 'sort': '-x'}, 'x': field('errors.doc_count', 'quantitative', 'errors')},
          [{'filter': 'datum.errors.doc_count > 0'}])
board('daily', 'Voxels / daily network errors (UTC)', 'now-30d/d', 60000)
for obj in objects:
    print(json.dumps(obj, separators=(',', ':')))
