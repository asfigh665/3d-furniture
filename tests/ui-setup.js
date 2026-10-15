import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

HTMLElement.prototype.scrollIntoView = function () {};
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
afterEach(cleanup);
