import { copy, getCopy } from './en';

describe('en.js Validation Boundaries', () => {
  describe('Dictionary structural integrity', () => {
    it('should exist and be a valid object', () => {
      expect(typeof copy).toBe('object');
      expect(copy).not.toBeNull();
    });

    it('should contain expected root sections', () => {
      expect(copy.home).toBeDefined();
      expect(copy.invest).toBeDefined();
      expect(copy.invoices).toBeDefined();
      expect(copy.wallet).toBeDefined();
    });
  });

  describe('getCopy validation & boundary handling', () => {
    it('should resolve a valid string path', () => {
      expect(getCopy('home.heroTitle')).toBe(copy.home.heroTitle);
      expect(getCopy('invest.detail.pageTitle')).toBe(copy.invest.detail.pageTitle);
    });

    it('should handle rejected input: invalid paths', () => {
      expect(getCopy(null)).toBe('Missing copy: invalid path');
      expect(getCopy(undefined)).toBe('Missing copy: invalid path');
      expect(getCopy(123)).toBe('Missing copy: invalid path');
      expect(getCopy('')).toBe('Missing copy: invalid path');
      expect(getCopy('   ')).toBe('Missing copy: invalid path');
    });

    it('should handle missing or incorrect paths', () => {
      expect(getCopy('home.doesNotExist')).toBe('Missing copy: home.doesNotExist');
      expect(getCopy('doesNotExist.something')).toBe('Missing copy: doesNotExist.something');
      // Accessing a path that resolves to an object, not a string
      expect(getCopy('home')).toBe('Missing copy: home');
      expect(getCopy('invest.detail')).toBe('Missing copy: invest.detail');
    });

    it('should correctly substitute variables (accepted input)', () => {
      const result = getCopy('invest.announceFilteredCount', { matched: 5, total: 10 });
      expect(result).toBe('5 of 10 invoices match');
    });

    it('should ignore duplicate and extraneous variables (duplicate/boundary input)', () => {
      const result = getCopy('invest.announceFilteredCount', { matched: 2, total: 4, extra: 'ignoreme', matched: 2 });
      expect(result).toBe('2 of 4 invoices match');
    });

    it('should gracefully handle missing or invalid substitution params (boundary input)', () => {
      // If a param is missing, the placeholder should remain as is, or we just handle it without throwing
      const result = getCopy('invest.announceFilteredCount', { matched: null, total: undefined });
      expect(result).toBe(' of  invoices match');
      
      const noParamsResult = getCopy('invest.announceFilteredCount');
      expect(noParamsResult).toBe('{matched} of {total} invoices match');
      
      const invalidParamsResult = getCopy('invest.announceFilteredCount', null);
      expect(invalidParamsResult).toBe('{matched} of {total} invoices match');
    });

    it('should protect against malicious string replacements (boundary input)', () => {
      // Trying to inject a regex string to break the split/join
      const result = getCopy('invest.announceFilteredCount', { matched: '.*+', total: 5 });
      expect(result).toBe('.*+ of 5 invoices match');
    });

    it('should enforce variable substitution types', () => {
      const result = getCopy('invest.announceFilteredCount', { matched: [1, 2], total: { a: 1 } });
      expect(result).toBe('1,2 of [object Object] invoices match');
    });
  });
});
