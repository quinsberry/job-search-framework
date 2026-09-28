import unittest
from decimal import Decimal

from convert_fx import convert, parse_rates


class ConvertFxTest(unittest.TestCase):
    def test_parses_ecb_rates_and_converts_through_eur(self):
        xml = b"""<Envelope xmlns='urn:ecb'><Cube><Cube time='2026-09-28'>
            <Cube currency='USD' rate='1.25'/><Cube currency='PLN' rate='4.00'/>
        </Cube></Cube></Envelope>"""
        date, rates = parse_rates(xml)

        self.assertEqual(date, "2026-09-28")
        self.assertEqual(convert(Decimal("125"), "USD", "PLN", rates), Decimal("400"))
        self.assertEqual(convert(Decimal("125"), "USD", "EUR", rates), Decimal("100"))


if __name__ == "__main__":
    unittest.main()
