# Copyright (c) 2025, FardaERP Team
# License: GNU General Public License v3. See license.txt

"""
Iranian Localization Utilities for FardaERP

Provides utility functions for:
- Jalali/Gregorian date conversion
- Rial/Toman currency conversion
- Persian number formatting
- Iranian phone validation
- Iranian IBAN validation
"""

import re
from typing import Optional, Tuple


# =============================================================================
# Jalali Date Conversion
# =============================================================================

def gregorian_to_jalali(gy: int, gm: int, gd: int) -> Tuple[int, int, int]:
    """
    Convert Gregorian date to Jalali (Persian) date.
    
    Args:
        gy: Gregorian year
        gm: Gregorian month (1-12)
        gd: Gregorian day (1-31)
    
    Returns:
        Tuple of (jalali_year, jalali_month, jalali_day)
    """
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    
    jy = 0 if gy <= 1600 else 979
    gy -= 1600 if gy <= 1600 else 1600
    
    gy2 = 1 if gm > 2 else 0
    days_elapsed = 365 * gy + ((gy + 3) // 4) - ((gy + 99) // 100) + ((gy + 399) // 400) - 80 + gd + g_d_m[gm - 1] + gy2
    
    jy += 33 * (days_elapsed // 12053)
    days_elapsed %= 12053
    jy += 4 * (days_elapsed // 1461)
    days_elapsed %= 1461
    
    jy += (days_elapsed - 1) // 365
    if days_elapsed >= 366:
        days_elapsed %= 365
    
    jm = 1
    while days_elapsed >= 31 and jm < 6:
        days_elapsed -= 31
        jm += 1
    
    if days_elapsed >= 30 and jm >= 6:
        days_elapsed -= 30
        jm += 1
    
    jd = days_elapsed + 1
    jy += 1
    
    return (jy, jm, jd)


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> Tuple[int, int, int]:
    """
    Convert Jalali (Persian) date to Gregorian date.
    
    Args:
        jy: Jalali year
        jm: Jalali month (1-12)
        jd: Jalali day (1-31)
    
    Returns:
        Tuple of (gregorian_year, gregorian_month, gregorian_day)
    """
    gy = 1600
    jy -= 979
    
    days_elapsed = 365 * jy + (jy // 4) - (jy // 100) + (jy // 400) + 78 + jd - 1
    
    if jm > 6:
        days_elapsed += 186
    else:
        days_elapsed += 31 * (jm - 1)
    
    gy += 400 * (days_elapsed // 146097)
    days_elapsed %= 146097
    
    if days_elapsed >= 36525:
        gy += 100 * (days_elapsed // 36525)
        days_elapsed %= 36525
        
        if days_elapsed >= 365:
            gy += 4 * (days_elapsed // 1461)
            days_elapsed %= 1461
            
            if days_elapsed >= 366:
                gy += (days_elapsed - 1) // 365
                days_elapsed = (days_elapsed - 1) % 365
    
    months = [31, 28 + (1 if (gy % 4 == 0 and (gy % 100 != 0 or gy % 400 == 0)) else 0)]
    month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    
    if gy % 4 == 0 and (gy % 100 != 0 or gy % 400 == 0):
        month_days[1] = 29
    
    gm = 1
    while days_elapsed >= month_days[gm - 1]:
        days_elapsed -= month_days[gm - 1]
        gm += 1
    
    gd = days_elapsed + 1
    
    return (gy, gm, gd)


def format_jalali_date(date_string: str) -> str:
    """
    Format a Jalali date string as YYYY-MM-DD.
    
    Args:
        date_string: Date string in various formats
    
    Returns:
        Formatted date string
    """
    # Implementation depends on input format
    return date_string


# =============================================================================
# Currency Conversion
# =============================================================================

def toman_to_rial(amount: float) -> float:
    """
    Convert Toman to Rial.
    
    Args:
        amount: Amount in Toman
    
    Returns:
        Amount in Rial
    """
    return amount * 10


def rial_to_toman(amount: float) -> float:
    """
    Convert Rial to Toman.
    
    Args:
        amount: Amount in Rial
    
    Returns:
        Amount in Toman
    """
    return amount / 10


# =============================================================================
# Persian Number Formatting
# =============================================================================

def to_persian_digits(number: str) -> str:
    """
    Convert English digits to Persian digits.
    
    Args:
        number: String containing English digits
    
    Returns:
        String with Persian digits
    """
    english_to_persian = {
        '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
        '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹'
    }
    
    result = ""
    for char in str(number):
        result += english_to_persian.get(char, char)
    
    return result


def to_english_digits(number: str) -> str:
    """
    Convert Persian digits to English digits.
    
    Args:
        number: String containing Persian digits
    
    Returns:
        String with English digits
    """
    persian_to_english = {
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
        '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    }
    
    result = ""
    for char in str(number):
        result += persian_to_english.get(char, char)
    
    return result


def format_currency(amount: float, currency: str = "IRT", use_persian: bool = False) -> str:
    """
    Format currency amount with thousand separators.
    
    Args:
        amount: Amount to format
        currency: Currency code (IRT for Toman, IRR for Rial)
        use_persian: Whether to use Persian digits
    
    Returns:
        Formatted currency string
    """
    # Format with thousand separators
    formatted = "{:,.0f}".format(amount)
    
    if use_persian:
        formatted = to_persian_digits(formatted)
    
    currency_symbol = "تومان" if currency == "IRT" else "ریال"
    return f"{formatted} {currency_symbol}"


# =============================================================================
# Validation
# =============================================================================

def validate_iranian_mobile(phone: str) -> bool:
    """
    Validate Iranian mobile phone number.
    
    Args:
        phone: Phone number to validate
    
    Returns:
        True if valid, False otherwise
    """
    pattern = r'^09[0-9]{9}$'
    return bool(re.match(pattern, phone))


def validate_iranian_national_code(code: str) -> bool:
    """
    Validate Iranian National Code (کد ملی).
    
    Args:
        code: National code to validate
    
    Returns:
        True if valid, False otherwise
    """
    if not re.match(r'^[0-9]{10}$', code):
        return False
    
    code_int = [int(x) for x in code]
    
    if len(set(code_int)) == 1:
        return False
    
    check_sum = sum(code_int[i] * (10 - i) for i in range(9))
    remainder = check_sum % 11
    
    if remainder < 2:
        return code_int[9] == remainder
    else:
        return code_int[9] == 11 - remainder


def validate_iranian_iban(iban: str) -> bool:
    """
    Validate Iranian IBAN.
    
    Args:
        iban: IBAN to validate
    
    Returns:
        True if valid, False otherwise
    """
    pattern = r'^IR[0-9]{24}$'
    if not re.match(pattern, iban):
        return False
    
    # Additional validation can be added here
    return True


def validate_iranian_economic_code(code: str) -> bool:
    """
    Validate Iranian Economic Code (کد اقتصادی).
    
    Args:
        code: Economic code to validate
    
    Returns:
        True if valid, False otherwise
    """
    pattern = r'^[0-9]{11,12}$'
    return bool(re.match(pattern, code))


# =============================================================================
# Normalization
# =============================================================================

def normalize_persian_text(text: str) -> str:
    """
    Normalize Persian text for search and comparison.
    
    Args:
        text: Text to normalize
    
    Returns:
        Normalized text
    """
    # Replace Arabic characters with Persian equivalents
    replacements = {
        'ي': 'ی',
        'ك': 'ک',
        '‌': ' ',  # Zero-width non-joiner to space
        '\u200c': ' ',  # Another zero-width non-joiner
    }
    
    for arabic, persian in replacements.items():
        text = text.replace(arabic, persian)
    
    return text.strip()

