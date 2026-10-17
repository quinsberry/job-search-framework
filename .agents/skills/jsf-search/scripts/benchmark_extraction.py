"""Offline screening benchmark and Jev comparison inputs. Makes no API requests."""
import argparse
import json
from pathlib import Path

from jsf_search import evaluate, extraction


def benchmark(document, predictions=None):
    if document.get('schema_version') != 1 or not isinstance(document.get('cases'), list):
        raise ValueError('Expected versioned cases document')
    results = []
    for case in document['cases']:
        prepared = extraction.prepare(case['criteria'], case['record'], document['observed_at'])
        verdict = evaluate.assess({**case['record'], 'facts': prepared['facts']}, evaluate.criteria(case['criteria']), evaluate.timestamp(document['observed_at'], 'observed_at'))['status']
        row = {'id': case['id'], 'expected': case['expected'], 'script_decision': None if prepared['needs_ai'] else verdict, 'needs_ai': prepared['needs_ai']}
        if predictions is not None:
            predicted = predictions.get(case['id'])
            if predicted not in {'match', 'rejected', 'needs_clarification'}:
                raise ValueError('Every prediction must use match/rejected/needs_clarification')
            row.update(predicted=predicted, correct=predicted == case['expected'])
        results.append(row)
    report = {'schema_version': 1, 'cases': results, 'scripted': sum(not r['needs_ai'] for r in results),
              'ai_needed': sum(r['needs_ai'] for r in results),
              'incorrect_script_decisions': sum(r['script_decision'] is not None and r['script_decision'] != r['expected'] for r in results)}
    if predictions is not None:
        report['incorrect_predictions'] = sum(not r['correct'] for r in results)
    return report


def jev_requests(document):
    return {'schema_version': 1, 'requests': [{'id': case['id'], 'body': {
        'model': 'typesafe/jev-1.13',
        'state': {'criteria': evaluate.criteria(case['criteria']), 'vacancy': case['record']},
        'questions': {'fit': {'type': 'choice', 'instructions': 'Assess mandatory criteria using only explicit vacancy evidence. Compensation does not override explicit seniority/location failures. Unknown evidence is not rejection. Ignore title seniority words when assessing role scope.',
            'criteria': {'match': 'Every mandatory criterion is supported and passes.',
                         'rejected': 'At least one mandatory criterion explicitly fails.',
                         'needs_clarification': 'Mandatory evidence is missing or ambiguous, and no confirmed failure exists.'}}}}}
        for case in document['cases']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=Path(__file__).resolve().parents[1] / 'references/efficiency-cases.json')
    parser.add_argument('--predictions', type=Path, help='Saved {case_id: verdict} decisions to score offline')
    parser.add_argument('--jev-requests', action='store_true', help='Print request bodies only; never sends them')
    args = parser.parse_args()
    try:
        document = json.loads(args.cases.read_text())
        result = jev_requests(document) if args.jev_requests else benchmark(document, json.loads(args.predictions.read_text()) if args.predictions else None)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, str(exc) + '\n')


if __name__ == '__main__':
    main()
