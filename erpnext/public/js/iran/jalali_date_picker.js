/*
 * FardaERP - Jalali Date Picker Support
 * Copyright (c) 2025, FardaERP Team
 * License: GNU General Public License v3
 */

/**
 * Persian/Jalali Date Picker for FardaERP
 * Converts Gregorian dates to Jalali for display and vice versa
 */

frappe.provide('fardaerp');

fardaerp.JalaliDate = class JalaliDate {
	constructor() {
		this.setupUtils();
	}

	setupUtils() {
		// Utility functions for date conversion
		this.gregorianToJalali = this.gregorianToJalali.bind(this);
		this.jalaliToGregorian = this.jalaliToGregorian.bind(this);
		this.toPersianDigits = this.toPersianDigits.bind(this);
		this.fromPersianDigits = this.fromPersianDigits.bind(this);
	}

	/**
	 * Convert Gregorian date to Jalali
	 * @param {number} gy - Gregorian year
	 * @param {number} gm - Gregorian month (1-12)
	 * @param {number} gd - Gregorian day (1-31)
	 * @returns {Array} [jy, jm, jd] - Jalali year, month, day
	 */
	gregorianToJalali(gy, gm, gd) {
		const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
		
		let jy = gy <= 1600 ? 0 : 979;
		gy -= gy <= 1600 ? 1600 : 1600;
		
		const gy2 = gm > 2 ? 1 : 0;
		let days_elapsed = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400) - 80 + gd + g_d_m[gm - 1] + gy2;
		
		jy += 33 * Math.floor(days_elapsed / 12053);
		days_elapsed %= 12053;
		jy += 4 * Math.floor(days_elapsed / 1461);
		days_elapsed %= 1461;
		
		jy += Math.floor((days_elapsed - 1) / 365);
		if (days_elapsed >= 366) {
			days_elapsed %= 365;
		}
		
		let jm = 1;
		while (days_elapsed >= 31 && jm < 6) {
			days_elapsed -= 31;
			jm++;
		}
		
		if (days_elapsed >= 30 && jm >= 6) {
			days_elapsed -= 30;
			jm++;
		}
		
		const jd = days_elapsed + 1;
		jy++;
		
		return [jy, jm, jd];
	}

	/**
	 * Convert Jalali date to Gregorian
	 * @param {number} jy - Jalali year
	 * @param {number} jm - Jalali month (1-12)
	 * @param {number} jd - Jalali day (1-31)
	 * @returns {Array} [gy, gm, gd] - Gregorian year, month, day
	 */
	jalaliToGregorian(jy, jm, jd) {
		let gy = 1600;
		jy -= 979;
		
		let days_elapsed = 365 * jy + Math.floor(jy / 4) - Math.floor(jy / 100) + Math.floor(jy / 400) + 78 + jd - 1;
		
		if (jm > 6) {
			days_elapsed += 186;
		} else {
			days_elapsed += 31 * (jm - 1);
		}
		
		gy += 400 * Math.floor(days_elapsed / 146097);
		days_elapsed %= 146097;
		
		if (days_elapsed >= 36525) {
			gy += 100 * Math.floor(days_elapsed / 36525);
			days_elapsed %= 36525;
			
			if (days_elapsed >= 365) {
				gy += 4 * Math.floor(days_elapsed / 1461);
				days_elapsed %= 1461;
				
				if (days_elapsed >= 366) {
					gy += Math.floor((days_elapsed - 1) / 365);
					days_elapsed = (days_elapsed - 1) % 365;
				}
			}
		}
		
		const month_days = [31, (gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		
		let gm = 1;
		while (days_elapsed >= month_days[gm - 1]) {
			days_elapsed -= month_days[gm - 1];
			gm++;
		}
		
		const gd = days_elapsed + 1;
		
		return [gy, gm, gd];
	}

	/**
	 * Convert English digits to Persian
	 * @param {string|number} number - Number to convert
	 * @returns {string} Persian digits
	 */
	toPersianDigits(number) {
		const englishToPersian = {
			'0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
			'5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹'
		};
		
		return String(number).split('').map(char => englishToPersian[char] || char).join('');
	}

	/**
	 * Convert Persian digits to English
	 * @param {string} number - Persian digits
	 * @returns {string} English digits
	 */
	fromPersianDigits(number) {
		const persianToEnglish = {
			'۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
			'۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
		};
		
		return String(number).split('').map(char => persianToEnglish[char] || char).join('');
	}

	/**
	 * Format date as Jalali string
	 * @param {Date} date - Date object
	 * @param {string} format - Output format (default: YYYY-MM-DD)
	 * @returns {string} Formatted Jalali date
	 */
	formatJalali(date, format = 'YYYY-MM-DD') {
		const [jy, jm, jd] = this.gregorianToJalali(
			date.getFullYear(),
			date.getMonth() + 1,
			date.getDate()
		);
		
		const year = this.toPersianDigits(jy);
		const month = this.toPersianDigits(String(jm).padStart(2, '0'));
		const day = this.toPersianDigits(String(jd).padStart(2, '0'));
		
		return format
			.replace('YYYY', year)
			.replace('MM', month)
			.replace('DD', day);
	}

	/**
	 * Parse Jalali date string to Date object
	 * @param {string} jalaliString - Jalali date string (YYYY-MM-DD)
	 * @returns {Date} Date object
	 */
	parseJalali(jalaliString) {
		const parts = jalaliString.split('-').map(p => parseInt(this.fromPersianDigits(p)));
		const [jy, jm, jd] = parts;
		
		const [gy, gm, gd] = this.jalaliToGregorian(jy, jm, jd);
		return new Date(gy, gm - 1, gd);
	}
};

// Initialize JalaliDate utility
fardaerp.jalaliDate = new fardaerp.JalaliDate();

/**
 * Override Frappe's date picker to support Jalali dates
 */
frappe.ui.form.Control.Date.prototype.make_input = function() {
	this._super();
	
	if (frappe.boot.lang === 'fa') {
		this.setupJalaliDatePicker();
	}
};

frappe.ui.form.Control.Date.prototype.setupJalaliDatePicker = function() {
	const self = this;
	
	// Store original value in Gregorian
	this.$input.on('change', function() {
		const jalaliValue = $(this).val();
		if (jalaliValue) {
			try {
				const gregorianDate = fardaerp.jalaliDate.parseJalali(jalaliValue);
				const gregorianString = frappe.datetime.strftime(gregorianDate, 'YYYY-MM-DD');
				self.set_input(gregorianString);
			} catch (e) {
				console.error('Error parsing Jalali date:', e);
			}
		}
	});
};

/**
 * Display dates in Jalali format in forms
 */
frappe.ui.form.Control.Date.prototype.set_formatted_input = function(value) {
	if (!value) {
		this.$input.val('');
		return;
	}
	
	if (frappe.boot.lang === 'fa') {
		try {
			const date = frappe.datetime.str_to_obj(value);
			const jalaliString = fardaerp.jalaliDate.formatJalali(date);
			this.$input.val(jalaliString);
		} catch (e) {
			this.$input.val(value);
		}
	} else {
		this.$input.val(value);
	}
};

/**
 * Add Jalali date formatting to DateTime controls
 */
frappe.ui.form.Control.Datetime.prototype.set_formatted_input = function(value) {
	if (!value) {
		this.$input.val('');
		return;
	}
	
	if (frappe.boot.lang === 'fa') {
		try {
			const date = frappe.datetime.str_to_obj(value);
			const jalaliDate = fardaerp.jalaliDate.formatJalali(date);
			const time = fardaerp.jalaliDate.toPersianDigits(
				frappe.datetime.strftime(date, 'HH:mm:ss')
			);
			this.$input.val(`${jalaliDate} ${time}`);
		} catch (e) {
			this.$input.val(value);
		}
	} else {
		this.$input.val(value);
	}
};

/**
 * Format numbers in Persian for display
 */
fardaerp.formatNumber = function(number) {
	if (frappe.boot.lang !== 'fa') {
		return number;
	}
	
	return fardaerp.jalaliDate.toPersianDigits(
		Number(number).toLocaleString('en-US')
	);
};

/**
 * Format currency with Persian digits and Toman/Rial label
 */
fardaerp.formatCurrency = function(amount, currency = 'IRT') {
	if (frappe.boot.lang !== 'fa') {
		return frappe.format.currency(amount, null, { currency: currency });
	}
	
	const formatted = Number(amount).toLocaleString('en-US');
	const persianFormatted = fardaerp.jalaliDate.toPersianDigits(formatted);
	const currencyLabel = currency === 'IRT' ? 'تومان' : 'ریال';
	
	return `${persianFormatted} ${currencyLabel}`;
};

/**
 * Auto-detect and set RTL direction based on language
 */
$(document).ready(function() {
	if (frappe.boot && frappe.boot.lang === 'fa') {
		$('html').attr('dir', 'rtl');
		$('body').addClass('rtl');
		
		// Apply Persian number formatting to all number displays
		$('.persian-number').each(function() {
			const text = $(this).text();
			$(this).text(fardaerp.jalaliDate.toPersianDigits(text));
		});
	}
});

console.log('FardaERP Jalali Date Picker loaded');
