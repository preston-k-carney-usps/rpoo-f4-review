/**
 * reviews.js — Review management.
 *
 * A "review" is a package that can contain one or more offices:
 *   - name: descriptive label for the review package
 *   - Overall date range (start / end)
 *   - offices: array of { financeNum, officeName, startDate, endDate }
 *   - assignments: which users are assigned, each with a review-specific role
 *
 * Backward compat: old reviews with root-level financeNum/officeName
 * are auto-migrated to the offices[] format on read.
 *
 * Data stored in localStorage:
 *   clerk_obs_reviews — Array of review objects
 */

var Reviews = (function() {
  var REVIEWS_KEY = 'clerk_obs_reviews';

  /** Migrate old single-office format to multi-office */
  function _migrate(rev) {
    if (!rev.offices) {
      rev.offices = [];
      if (rev.financeNum || rev.officeName) {
        rev.offices.push({
          financeNum: rev.financeNum || '',
          officeName: rev.officeName || '',
          startDate: rev.startDate || '',
          endDate: rev.endDate || ''
        });
      }
      if (!rev.name) {
        rev.name = rev.officeName || 'Review';
      }
      // Keep root-level financeNum/officeName for backward compat reads
    }
    return rev;
  }

  function getAll() {
    try {
      var raw = JSON.parse(localStorage.getItem(REVIEWS_KEY)) || [];
      return raw.map(_migrate);
    }
    catch(e) { return []; }
  }

  function _save(reviews) {
    localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
  }

  function getById(id) {
    var all = getAll();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  /**
   * Create a new review package.
   * data: { name, startDate, endDate, offices: [{financeNum, officeName, startDate, endDate}],
   *         assignments: [{ userId, reviewRole }], createdBy }
   */
  function create(data) {
    var reviews = getAll();
    var review = {
      id: crypto.randomUUID(),
      name: data.name || '',
      offices: data.offices || [],
      startDate: data.startDate,
      endDate: data.endDate,
      assignments: data.assignments || [],
      createdBy: data.createdBy || '',
      createdAt: new Date().toISOString()
    };
    // Backward compat: set root-level fields from first office
    if (review.offices.length > 0) {
      review.financeNum = review.offices[0].financeNum;
      review.officeName = review.offices[0].officeName;
    }
    reviews.push(review);
    _save(reviews);
    return review;
  }

  function update(id, data) {
    var reviews = getAll();
    for (var i = 0; i < reviews.length; i++) {
      if (reviews[i].id === id) {
        if (data.name !== undefined) reviews[i].name = data.name;
        if (data.offices !== undefined) reviews[i].offices = data.offices;
        if (data.startDate !== undefined) reviews[i].startDate = data.startDate;
        if (data.endDate !== undefined) reviews[i].endDate = data.endDate;
        if (data.assignments !== undefined) reviews[i].assignments = data.assignments;
        // Keep backward compat root fields in sync
        if (data.offices && data.offices.length > 0) {
          reviews[i].financeNum = data.offices[0].financeNum;
          reviews[i].officeName = data.offices[0].officeName;
        }
        _save(reviews);
        return reviews[i];
      }
    }
    return null;
  }

  function remove(id) {
    var reviews = getAll().filter(function(r) { return r.id !== id; });
    _save(reviews);
  }

  /** Get reviews assigned to a specific user (by userId). */
  function getForUser(userId) {
    return getAll().filter(function(r) {
      return r.assignments.some(function(a) { return a.userId === userId; });
    });
  }

  /** Get the assignment entry for a specific user within a review. */
  function getUserAssignment(reviewId, userId) {
    var review = getById(reviewId);
    if (!review) return null;
    for (var i = 0; i < review.assignments.length; i++) {
      if (review.assignments[i].userId === userId) return review.assignments[i];
    }
    return null;
  }

  /** Check if a date string (YYYY-MM-DD) falls within a review's date range. */
  function isDateInRange(review, dateStr) {
    if (!review.startDate || !review.endDate || !dateStr) return false;
    return dateStr >= review.startDate && dateStr <= review.endDate;
  }

  /** Check if a finance number belongs to this review */
  function hasOffice(review, financeNum) {
    if (!review.offices) return review.financeNum === financeNum;
    return review.offices.some(function(o) { return o.financeNum === financeNum; });
  }

  /** Get all finance numbers for a review */
  function getFinanceNums(review) {
    if (!review.offices || review.offices.length === 0) {
      return review.financeNum ? [review.financeNum] : [];
    }
    return review.offices.map(function(o) { return o.financeNum; });
  }

  return {
    getAll: getAll,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    getForUser: getForUser,
    getUserAssignment: getUserAssignment,
    isDateInRange: isDateInRange,
    hasOffice: hasOffice,
    getFinanceNums: getFinanceNums
  };
})();
