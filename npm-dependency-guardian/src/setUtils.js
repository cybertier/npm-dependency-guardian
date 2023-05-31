/**
 * Method of the Set class that creates the union of the calling object, and another set
 * @param   {Set} other Other set to create the union with
 * @returns {Set}       New set representing the set union
 */
function setUnion(other) {
  let s = new Set();
  for (const element of this) {
    s.add(element);
  }
  for (const element of other) {
    s.add(element);
  }
  return s;
}

/**
 * Method of the Set class that creates the intersection of the calling object, and another set
 * @param   {Set} other Other set to create the intersection with
 * @returns {Set}       New set representing the set intersection
 */
function setIntersection(other) {
  let s = new Set();
  for (const element of this) {
    if (other.has(element)) {
      s.add(element);
    }
  }
  return s;
}

/**
 * Method of the Set class that creates the difference of the calling object, and another set
 * @param   {Set} other Other set to create the difference with
 * @returns {Set}       New set representing the set difference
 */
function setDifference(other) {
  let s = new Set();
  for (const element of this) {
    if (!other.has(element)) {
      s.add(element);
    }
  }
  return s;
}

/**
 * Method of the Set class that filters the objects inside the set by a given filter function
 * @param   {Function} filter Function that takes an element, and returns true if it passes the filter, and false else
 * @returns {Set}             New set only containing the elements that passed the filter
 */
function setFilter(filter) {
  const s = new Set();
  for (const element of this) {
    if (filter(element)) {
      s.add(element);
    }
  }
  return s;
}

/**
 * Method of the Set class that maps the objects inside the set with a given map function
 * @param   {Function} map Function that takes an element and maps it to the desired new value
 * @returns {Set}          New set only containing the elements that passed the filter
 */
function setMap(map) {
  const s = new Set();
  for (const element of this) {
    s.add(map(element));
  }
  return s;
}

// This is very illegal but we do it anyways
Set.prototype.union = setUnion;
Set.prototype.intersection = setIntersection;
Set.prototype.filter = setFilter;
Set.prototype.map = setMap;
Set.prototype.difference = setDifference;
