#!/usr/bin/env python3
"""Display a salary range in PLN, USD, and EUR using ECB reference rates."""

import argparse
from decimal import Decimal, ROUND_HALF_UP
from urllib.request import urlopen
from xml.etree import ElementTree


ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"


def parse_rates(xml: bytes) -> tuple[str, dict[str, Decimal]]:
    root = ElementTree.fromstring(xml)
    dated = next(node for node in root.iter() if "time" in node.attrib)
    rates = {"EUR": Decimal(1)}
    rates.update(
        (node.attrib["currency"], Decimal(node.attrib["rate"]))
        for node in dated
        if "currency" in node.attrib
    )
    return dated.attrib["time"], rates


def convert(amount: Decimal, source: str, target: str, rates: dict[str, Decimal]) -> Decimal:
    return amount / rates[source] * rates[target]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("low", type=Decimal)
    parser.add_argument("high", type=Decimal)
    parser.add_argument("currency", type=str.upper)
    args = parser.parse_args()
    if args.low < 0 or args.high < args.low:
        parser.error("require 0 <= LOW <= HIGH")

    with urlopen(ECB_URL, timeout=10) as response:
        date, rates = parse_rates(response.read())
    if args.currency not in rates:
        parser.error(f"ECB does not publish {args.currency}; use another dated FX source")

    print(f"ECB reference rates: {date}; input: {args.currency} {args.low}–{args.high}")
    for currency in ("PLN", "USD", "EUR"):
        if currency not in rates:
            parser.error(f"ECB did not publish {currency} for {date}")
        low = convert(args.low, args.currency, currency, rates)
        high = convert(args.high, args.currency, currency, rates)
        whole = Decimal("1")
        print(f"{currency}: {low.quantize(whole, rounding=ROUND_HALF_UP)}–{high.quantize(whole, rounding=ROUND_HALF_UP)}")


if __name__ == "__main__":
    main()
