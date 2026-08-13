/* JB Studio — flujo de reservas v2.
 *
 * Módulo aislado: no conoce DOM, estilos, endpoints ni IA. Las superficies de
 * chat aportarán los adaptadores cuando este flujo se migre en una fase futura.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JBChatFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STEPS = Object.freeze({
    CHAT: 'CHAT',
    SERVICE_SELECTION: 'SERVICE_SELECTION',
    BARBER_SELECTION: 'BARBER_SELECTION',
    DATE_SELECTION: 'DATE_SELECTION',
    PEOPLE_SELECTION: 'PEOPLE_SELECTION',
    TIME_SELECTION: 'TIME_SELECTION',
    CUSTOMER_DATA: 'CUSTOMER_DATA',
    SUMMARY: 'SUMMARY',
    CONFIRMATION: 'CONFIRMATION',
    CONFIRMED: 'CONFIRMED',
  });

  var EVENTS = Object.freeze({
    START_BOOKING: 'START_BOOKING',
    SELECT_SERVICE: 'SELECT_SERVICE',
    SELECT_BARBER: 'SELECT_BARBER',
    SELECT_DATE: 'SELECT_DATE',
    SELECT_PEOPLE: 'SELECT_PEOPLE',
    SELECT_TIME: 'SELECT_TIME',
    SET_CUSTOMER_DATA: 'SET_CUSTOMER_DATA',
    SET_RESTAURANT_PREFERENCES: 'SET_RESTAURANT_PREFERENCES',
    EDIT_SERVICE: 'EDIT_SERVICE',
    EDIT_DATE: 'EDIT_DATE',
    EDIT_TIME: 'EDIT_TIME',
    EDIT_CUSTOMER: 'EDIT_CUSTOMER',
    SHOW_SUMMARY: 'SHOW_SUMMARY',
    REQUEST_CONFIRMATION: 'REQUEST_CONFIRMATION',
    CONFIRM_BOOKING: 'CONFIRM_BOOKING',
    RESET_FLOW: 'RESET_FLOW',
  });

  var STEP_VALUES = Object.keys(STEPS).map(function (key) { return STEPS[key]; });
  var EVENT_VALUES = Object.keys(EVENTS).map(function (key) { return EVENTS[key]; });

  function emptyCustomer() {
    return { name: null, phone: null, email: null };
  }

  function createInitialState() {
    return {
      version: 2,
      step: STEPS.CHAT,
      service: null,
      date: null,
      time: null,
      people: null,
      customer: emptyCustomer(),
      specialRequests: null,
      foodPreferences: null,
      tablePreference: null,
      barberPreference: null,
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function customerError(customer) {
    var name = String(customer && customer.name || '').trim();
    var phone = String(customer && customer.phone || '').replace(/\D/g, '');
    var email = String(customer && customer.email || '').trim();
    if (name.length < 2) return 'Indica un nombre válido.';
    if (phone.length < 7 || phone.length > 15) return 'Indica un teléfono válido.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Indica un correo válido.';
    return '';
  }

  function stateError(state) {
    if (!state || typeof state !== 'object') return 'El estado debe ser un objeto.';
    if (state.version !== 2) return 'La versión del estado debe ser 2.';
    if (STEP_VALUES.indexOf(state.step) === -1) return 'El paso del estado no es válido.';
    if (!(state.service === null || isNonEmptyString(state.service))) return 'El servicio debe ser null o texto no vacío.';
    if (!(state.date === null || isNonEmptyString(state.date))) return 'La fecha debe ser null o texto no vacío.';
    if (!(state.time === null || isNonEmptyString(state.time))) return 'La hora debe ser null o texto no vacío.';
    if (!(state.people === null || (typeof state.people === 'number' && Number.isInteger(state.people) && state.people > 0))) {
      return 'people debe ser null o un entero positivo.';
    }
    if (!state.customer || typeof state.customer !== 'object') return 'El cliente debe ser un objeto.';
    for (var i = 0; i < ['name', 'phone', 'email'].length; i++) {
      var field = ['name', 'phone', 'email'][i];
      if (!(state.customer[field] === null || isNonEmptyString(state.customer[field]))) {
        return 'El campo customer.' + field + ' debe ser null o texto no vacío.';
      }
    }
    if (!(state.specialRequests === null || typeof state.specialRequests === 'string')) {
      return 'Las peticiones especiales deben ser null o texto.';
    }
    if (!(state.foodPreferences === null || (typeof state.foodPreferences === 'object' && !Array.isArray(state.foodPreferences)))) return 'Las preferencias de comida deben ser null u objeto.';
    if (!(state.tablePreference === null || isNonEmptyString(state.tablePreference))) return 'La preferencia de mesa debe ser null o texto no vacío.';
    if (!(state.barberPreference === null || isNonEmptyString(state.barberPreference))) return 'La preferencia de barbero debe ser null o texto no vacío.';
    return '';
  }

  function requiredDataError(state, step, config) {
    if (step === STEPS.DATE_SELECTION && (!isNonEmptyString(state.service) || (isRestaurant(config) && state.people === null))) return 'Se requiere servicio y personas antes de seleccionar fecha.';
    if (step === STEPS.TIME_SELECTION && (!isNonEmptyString(state.service) || !isNonEmptyString(state.date))) return 'Se requiere servicio y fecha antes de seleccionar hora.';
    if (step === STEPS.PEOPLE_SELECTION && !isNonEmptyString(state.service)) return 'Se requiere un servicio antes de seleccionar personas.';
    if (step === STEPS.TIME_SELECTION && state.people === null && isRestaurant(config)) return 'Se requiere cantidad de personas antes de seleccionar hora.';
    if (step === STEPS.CUSTOMER_DATA && (!isNonEmptyString(state.service) || !isNonEmptyString(state.date) || !isNonEmptyString(state.time))) return 'Se requiere servicio, fecha y hora antes de datos del cliente.';
    if ([STEPS.SUMMARY, STEPS.CONFIRMATION, STEPS.CONFIRMED].indexOf(step) !== -1) {
      if (!isNonEmptyString(state.service) || !isNonEmptyString(state.date) || !isNonEmptyString(state.time)) return 'Se requiere servicio, fecha y hora antes del resumen.';
      if (!isNonEmptyString(state.customer.name) || !isNonEmptyString(state.customer.phone) || !isNonEmptyString(state.customer.email)) return 'Se requieren los datos completos del cliente antes del resumen.';
      if (state.specialRequests === null) return 'Se requiere responder las peticiones especiales antes del resumen.';
    }
    return '';
  }

  function assertValidState(state, config) {
    var error = stateError(state) || requiredDataError(state, state.step, config);
    if (error) throw new Error(error);
  }

  function storageKey(config) {
    var clientId = config && (config.clientId || config.id);
    if (!isNonEmptyString(clientId)) throw new Error('config.clientId es obligatorio para persistir el flujo.');
    var namespace = config && config.storageNamespace;
    if (namespace !== undefined && !/^[a-z0-9]+$/.test(String(namespace))) throw new Error('config.storageNamespace no es válido.');
    return (namespace || 'jba') + '_' + clientId.trim() + '_booking_v2';
  }

  function isRestaurant(config) {
    return config && (config.templateId === 'restaurant' || config.vertical === 'restaurant');
  }

  function isBarber(config) {
    return config && (config.templateId === 'barber' || config.vertical === 'barber');
  }

  function configuredStaff(config) {
    var nested = config && config.config || {};
    var staff = config && (config.staff || config.barbers) || nested.staff || nested.barbers;
    return Array.isArray(staff) ? staff : [];
  }

  function createBookingFlow(options) {
    options = options || {};
    var config = options.config || {};
    var storage = options.storage || null;
    var adapters = {
      render: options.render || null,
      request: options.request || null,
      onMessage: options.onMessage || null,
    };
    var state = createInitialState();
    var confirmationRequest = null;

    function notify(event) {
      var snapshot = getState();
      if (adapters.render && typeof adapters.render.render === 'function') adapters.render.render(snapshot, event);
      if (adapters.onMessage && typeof adapters.onMessage === 'function') adapters.onMessage(snapshot, event);
      return snapshot;
    }

    function persist() {
      if (!storage) return;
      if (typeof storage.setItem !== 'function') throw new Error('storage.setItem debe ser una función.');
      storage.setItem(storageKey(config), serialize());
    }

    function init() {
      if (!storage) return getState();
      if (typeof storage.getItem !== 'function') throw new Error('storage.getItem debe ser una función.');
      var saved = storage.getItem(storageKey(config));
      if (saved) {
        restore(saved);
        return notify({ type: 'RESTORE_FLOW' });
      }
      return getState();
    }

    function getState() {
      return clone(state);
    }

    function setState(nextState) {
      var candidate = clone(nextState);
      assertValidState(candidate, config);
      state = candidate;
      persist();
      return getState();
    }

    function startBooking() {
      return dispatch({ type: EVENTS.START_BOOKING });
    }

    function requestSlots() {
      if (!adapters.request || typeof adapters.request.slots !== 'function') {
        throw new Error('request.slots debe ser una función para consultar horarios.');
      }
      if (state.step !== STEPS.TIME_SELECTION) throw new Error('Los horarios solo se consultan desde TIME_SELECTION.');
      return adapters.request.slots(getState());
    }

    function requestAvailableDates() {
      if (!adapters.request || typeof adapters.request.availableDates !== 'function') {
        throw new Error('request.availableDates debe ser una función para consultar fechas.');
      }
      if (state.step !== STEPS.DATE_SELECTION) throw new Error('Las fechas solo se consultan desde DATE_SELECTION.');
      return adapters.request.availableDates(getState());
    }

    function confirmBooking() {
      if (!adapters.request || typeof adapters.request.confirmBooking !== 'function') {
        throw new Error('request.confirmBooking debe ser una función para confirmar la reserva.');
      }
      if (state.step !== STEPS.CONFIRMATION) throw new Error('La reserva solo se confirma desde CONFIRMATION.');
      if (confirmationRequest) return confirmationRequest;
      confirmationRequest = Promise.resolve(adapters.request.confirmBooking(getState())).then(function (result) {
        if (result && result.ok === true) dispatch({ type: EVENTS.CONFIRM_BOOKING });
        return result;
      }).finally(function () {
        confirmationRequest = null;
      });
      return confirmationRequest;
    }

    function dispatch(event) {
      if (!event || typeof event !== 'object' || EVENT_VALUES.indexOf(event.type) === -1) {
        throw new Error('El evento no es válido.');
      }

      var next = getState();
      switch (event.type) {
        case EVENTS.RESET_FLOW:
          next = createInitialState();
          break;
        case EVENTS.START_BOOKING:
          if (next.step !== STEPS.CHAT) throw new Error('START_BOOKING solo se permite desde CHAT.');
          next.step = STEPS.SERVICE_SELECTION;
          break;
        case EVENTS.SELECT_SERVICE:
          if (next.step !== STEPS.SERVICE_SELECTION) throw new Error('SELECT_SERVICE solo se permite desde SERVICE_SELECTION.');
          if (!isNonEmptyString(event.service)) throw new Error('SELECT_SERVICE requiere un servicio válido.');
          next.service = event.service.trim();
          next.step = isRestaurant(config) ? STEPS.PEOPLE_SELECTION : (isBarber(config) && configuredStaff(config).length ? STEPS.BARBER_SELECTION : STEPS.DATE_SELECTION);
          break;
        case EVENTS.SELECT_BARBER:
          if (next.step !== STEPS.BARBER_SELECTION) throw new Error('SELECT_BARBER solo se permite desde BARBER_SELECTION.');
          if (event.barberPreference !== null && !isNonEmptyString(event.barberPreference)) throw new Error('SELECT_BARBER requiere un barbero válido o null.');
          next.barberPreference = event.barberPreference === null ? null : event.barberPreference.trim();
          next.step = STEPS.DATE_SELECTION;
          break;
        case EVENTS.SELECT_DATE:
          if (next.step !== STEPS.DATE_SELECTION) throw new Error('SELECT_DATE solo se permite desde DATE_SELECTION.');
          if (!isNonEmptyString(event.date)) throw new Error('SELECT_DATE requiere una fecha válida.');
          next.date = event.date.trim();
          next.step = STEPS.TIME_SELECTION;
          break;
        case EVENTS.SELECT_PEOPLE:
          if (next.step !== STEPS.PEOPLE_SELECTION) throw new Error('SELECT_PEOPLE solo se permite desde PEOPLE_SELECTION.');
          if (!Number.isInteger(event.people) || event.people < 1) throw new Error('SELECT_PEOPLE requiere una cantidad positiva de personas.');
          next.people = event.people;
          next.step = STEPS.DATE_SELECTION;
          break;
        case EVENTS.SELECT_TIME:
          if (next.step !== STEPS.TIME_SELECTION) throw new Error('SELECT_TIME solo se permite desde TIME_SELECTION.');
          if (!isNonEmptyString(event.time)) throw new Error('SELECT_TIME requiere una hora válida.');
          next.time = event.time.trim();
          next.step = STEPS.CUSTOMER_DATA;
          break;
        case EVENTS.SET_CUSTOMER_DATA:
          if (next.step !== STEPS.CUSTOMER_DATA) throw new Error('SET_CUSTOMER_DATA solo se permite desde CUSTOMER_DATA.');
          if (!event.customer || typeof event.customer !== 'object') throw new Error('SET_CUSTOMER_DATA requiere customer.');
          var customerErr = customerError(event.customer);
          if (customerErr) throw new Error(customerErr);
          next.customer = {
            name: event.customer.name == null ? null : String(event.customer.name).trim(),
            phone: event.customer.phone == null ? null : String(event.customer.phone).trim(),
            email: event.customer.email == null ? null : String(event.customer.email).trim(),
          };
          next.specialRequests = event.specialRequests == null ? null : String(event.specialRequests).trim();
          next.foodPreferences = event.foodPreferences === undefined ? next.foodPreferences : (event.foodPreferences == null ? null : clone(event.foodPreferences));
          next.tablePreference = event.tablePreference === undefined ? next.tablePreference : (event.tablePreference == null || String(event.tablePreference).trim() === '' ? null : String(event.tablePreference).trim());
          break;
        case EVENTS.SET_RESTAURANT_PREFERENCES:
          if (next.step !== STEPS.CUSTOMER_DATA) throw new Error('SET_RESTAURANT_PREFERENCES solo se permite desde CUSTOMER_DATA.');
          next.foodPreferences = event.foodPreferences == null ? next.foodPreferences : clone(event.foodPreferences);
          next.tablePreference = event.tablePreference == null || String(event.tablePreference).trim() === '' ? null : String(event.tablePreference).trim();
          break;
        case EVENTS.EDIT_SERVICE:
          if ([STEPS.SUMMARY, STEPS.CONFIRMATION].indexOf(next.step) === -1) throw new Error('EDIT_SERVICE solo se permite desde SUMMARY o CONFIRMATION.');
          next.service = null; next.date = null; next.time = null; next.people = null;
          next.step = STEPS.SERVICE_SELECTION;
          break;
        case EVENTS.EDIT_DATE:
          if ([STEPS.SUMMARY, STEPS.CONFIRMATION].indexOf(next.step) === -1) throw new Error('EDIT_DATE solo se permite desde SUMMARY o CONFIRMATION.');
          next.date = null; next.time = null;
          next.step = STEPS.DATE_SELECTION;
          break;
        case EVENTS.EDIT_TIME:
          if ([STEPS.SUMMARY, STEPS.CONFIRMATION].indexOf(next.step) === -1) throw new Error('EDIT_TIME solo se permite desde SUMMARY o CONFIRMATION.');
          next.time = null;
          next.step = STEPS.TIME_SELECTION;
          break;
        case EVENTS.EDIT_CUSTOMER:
          if ([STEPS.SUMMARY, STEPS.CONFIRMATION].indexOf(next.step) === -1) throw new Error('EDIT_CUSTOMER solo se permite desde SUMMARY o CONFIRMATION.');
          next.step = STEPS.CUSTOMER_DATA;
          break;
        case EVENTS.SHOW_SUMMARY:
          if (next.step !== STEPS.CUSTOMER_DATA) throw new Error('SHOW_SUMMARY solo se permite desde CUSTOMER_DATA.');
          next.step = STEPS.SUMMARY;
          break;
        case EVENTS.REQUEST_CONFIRMATION:
          if (next.step !== STEPS.SUMMARY) throw new Error('REQUEST_CONFIRMATION solo se permite desde SUMMARY.');
          next.step = STEPS.CONFIRMATION;
          break;
        case EVENTS.CONFIRM_BOOKING:
          if (next.step !== STEPS.CONFIRMATION) throw new Error('CONFIRM_BOOKING solo se permite desde CONFIRMATION.');
          next.step = STEPS.CONFIRMED;
          break;
      }

      setState(next);
      return notify(event);
    }

    function reset() {
      return dispatch({ type: EVENTS.RESET_FLOW });
    }

    function serialize() {
      return JSON.stringify(state);
    }

    function restore(serialized) {
      var candidate;
      try {
        candidate = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
      } catch (error) {
        throw new Error('No se pudo restaurar el estado de reserva v2.');
      }
      // Estados v2 guardados antes de añadir preferencias opcionales siguen
      // siendo válidos y no se migran desde el formato legacy.
      var initial = createInitialState();
      candidate = Object.assign(initial, candidate, {
        customer: Object.assign(emptyCustomer(), candidate && candidate.customer),
      });
      return setState(candidate);
    }

    return {
      adapters: adapters,
      init: init,
      startBooking: startBooking,
      requestAvailableDates: requestAvailableDates,
      requestSlots: requestSlots,
      confirmBooking: confirmBooking,
      getState: getState,
      setState: setState,
      dispatch: dispatch,
      reset: reset,
      serialize: serialize,
      restore: restore,
    };
  }

  return {
    STEPS: STEPS,
    EVENTS: EVENTS,
    createInitialState: createInitialState,
    customerError: customerError,
    createBookingFlow: createBookingFlow,
  };
});
