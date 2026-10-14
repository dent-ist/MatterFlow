import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FormEngine } from './form-engine';

describe('FormEngine', () => {
  let component: FormEngine;
  let fixture: ComponentFixture<FormEngine>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormEngine],
    }).compileComponents();

    fixture = TestBed.createComponent(FormEngine);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
