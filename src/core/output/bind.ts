/**
 * Method-binding helper for value objects handed to consumers.
 *
 * Output value objects — the `Out` channel and the spinner/progress handles
 * — expose methods that read instance state via `this`. Consumers naturally
 * detach those methods, either by destructuring
 * (`const { log } = out` / `const { succeed, fail } = spinner`) or by passing
 * them as callbacks (`promise.finally(spinner.stop)`). Detached, an unbound
 * prototype method loses its `this` and crashes on the first field access.
 *
 * {@linkcode bindMethods} eliminates that footgun by installing instance-bound
 * copies of every method, so the ergonomic usage is also the correct one.
 *
 * @module dreamcli/core/output/bind
 * @internal
 */

/**
 * Bind every method on an instance's prototype chain to the instance.
 *
 * Walks the prototype chain up to (but excluding) `Object.prototype`, binding
 * each method name exactly once — the most-derived definition wins, so subclass
 * overrides (e.g. `CaptureOutputChannel.spinner`) are preserved rather than
 * clobbered by a base-class version. Bound methods are installed as
 * non-enumerable own properties, mirroring the enumerability of the prototype
 * methods they shadow. Getters and non-function members are left untouched.
 *
 * Call this once, last, in a class constructor. Because it reads the live
 * prototype rather than a hand-maintained name list, methods added later are
 * bound automatically — the binding can't silently fall out of date.
 *
 * @param instance - The object whose methods should be bound to it.
 * @internal
 */
function bindMethods(instance: object): void {
	const bound = instance as Record<PropertyKey, unknown>;
	const seen = new Set<string>();
	let proto: object | null = Object.getPrototypeOf(instance);

	while (proto !== null && proto !== Object.prototype) {
		for (const name of Object.getOwnPropertyNames(proto)) {
			if (name === 'constructor' || seen.has(name)) continue;
			seen.add(name);

			const descriptor = Object.getOwnPropertyDescriptor(proto, name);
			if (descriptor === undefined || typeof descriptor.value !== 'function') continue;

			Object.defineProperty(bound, name, {
				value: descriptor.value.bind(instance),
				writable: true,
				enumerable: false,
				configurable: true,
			});
		}
		proto = Object.getPrototypeOf(proto);
	}
}

export { bindMethods };
